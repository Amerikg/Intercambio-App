import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  const escaped: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => escaped[character]);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return respond({ error: "Método no permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return respond({ error: "Inicia sesión para enviar una solicitud." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !adminEmail || !resendApiKey || !fromEmail) {
    console.error("Faltan secretos requeridos para missing-member.");
    return respond({ error: "El envío de solicitudes no está configurado." }, 500);
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    const user = userData.user;
    if (userError || !user?.email) {
      return respond({ error: "No se pudo verificar tu correo. Vuelve a iniciar sesión." }, 401);
    }

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const subfamily = typeof body.subfamily === "string" ? body.subfamily.trim() : "";
    if (!name || name.length > 80 || !subfamily || subfamily.length > 80) {
      return respond({ error: "Escribe un nombre y una subfamilia válidos." }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: existing, error: lookupError } = await adminClient
      .from("participant_claims")
      .select("id,status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.status === "accepted") {
      return respond({ error: "Tu correo ya está vinculado a un integrante." }, 409);
    }

    let claimId = existing?.id;
    if (existing) {
      const { error } = await adminClient
        .from("participant_claims")
        .update({
          requester_email: user.email,
          proposed_name: name,
          proposed_subfamily: subfamily,
          status: "pending",
        })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { data: claim, error } = await adminClient
        .from("participant_claims")
        .insert({
          user_id: user.id,
          requester_email: user.email,
          proposed_name: name,
          proposed_subfamily: subfamily,
        })
        .select("id")
        .single();
      if (error) throw error;
      claimId = claim.id;
    }

    const escapedName = escapeHtml(name);
    const escapedSubfamily = escapeHtml(subfamily);
    const escapedEmail = escapeHtml(user.email);
    const mailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Intercambio familiar <${fromEmail}>`,
        to: [adminEmail],
        subject: "Solicitud para agregar a un integrante al intercambio",
        html: `<p>Una persona solicita ser agregada al intercambio.</p><ul><li>Nombre: ${escapedName}</li><li>Subfamilia: ${escapedSubfamily}</li><li>Correo: ${escapedEmail}</li></ul><p>Solicitud: ${claimId}</p>`,
      }),
    });
    if (!mailResponse.ok) {
      const details = await mailResponse.text();
      console.error("Resend no pudo enviar el aviso:", details);
      return respond({ error: "La solicitud se guardó, pero no se pudo enviar el correo. Avisa al administrador por otro medio." }, 502);
    }

    return respond({ ok: true });
  } catch (error) {
    console.error("Error en solicitud de integrante:", error);
    return respond({ error: "No se pudo procesar la solicitud. Intenta de nuevo." }, 500);
  }
});
