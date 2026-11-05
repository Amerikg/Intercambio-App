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

// Se despliega sin verificación JWT: la persona aún no ha iniciado sesión.
// Solo avisa por correo de una solicitud pendiente ya guardada con la función SQL.
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return respond({ error: "Método no permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  if (!supabaseUrl || !serviceRoleKey || !adminEmail || !resendApiKey || !fromEmail) {
    console.error("Faltan secretos requeridos para missing-member.");
    return respond({ error: "El envío de avisos no está configurado." }, 500);
  }

  try {
    const body = await request.json();
    const requestId = typeof body.request_id === "string" ? body.request_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
      return respond({ error: "Solicitud no válida." }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: pending, error } = await adminClient
      .from("registration_requests")
      .select("name,email,status")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw error;
    if (!pending || pending.status !== "pending") {
      return respond({ error: "La solicitud no está pendiente." }, 404);
    }

    const mailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Intercambio familiar <${fromEmail}>`,
        to: [adminEmail],
        subject: "Integrante no registrado solicita entrar al intercambio",
        html: `<p>Una persona no registrada solicita entrar al intercambio. Revísala en Administración.</p><ul><li>Nombre: ${escapeHtml(pending.name)}</li><li>Correo: ${escapeHtml(pending.email)}</li></ul>`,
      }),
    });
    if (!mailResponse.ok) {
      console.error("Resend no pudo enviar el aviso:", await mailResponse.text());
      return respond({ error: "No se pudo enviar el correo al administrador." }, 502);
    }
    return respond({ ok: true });
  } catch (error) {
    console.error("Error en solicitud de integrante:", error);
    return respond({ error: "No se pudo procesar la solicitud." }, 500);
  }
});
