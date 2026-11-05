const config = window.INTERCAMBIO_CONFIG ?? {};
const supabaseLibraryAvailable = Boolean(window.supabase?.createClient);
const configured =
  supabaseLibraryAvailable && Boolean(config.supabaseUrl && config.supabaseAnonKey);
const db = configured
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

const PENDING_KEY = "intercambio-acceso-pendiente";
const MISSING_OPTION = "__no_estoy__";

const byId = (id) => document.getElementById(id);
const el = Object.fromEntries(
  [
    "configWarning",
    "authPanel",
    "appPanel",
    "authForm",
    "whoSelect",
    "missingFields",
    "missingName",
    "missingSubfamily",
    "emailInput",
    "codeForm",
    "codeInput",
    "changeEmailButton",
    "authMessage",
    "accountEmail",
    "signOutButton",
    "adminTab",
    "welcomeMessage",
    "rosterCard",
    "rosterList",
    "rosterMessage",
    "drawStatus",
    "unlinkedPanel",
    "unlinkedSignOutButton",
    "participantPanel",
    "myName",
    "attendanceStatus",
    "assignmentCard",
    "recipientName",
    "wishlistForm",
    "tastesInput",
    "wishlistInput",
    "wishlistMessage",
    "wishlistGuestMessage",
    "wishlistBoard",
    "adminStatus",
    "refreshAdminButton",
    "closeAttendanceButton",
    "authorizeButton",
    "createDrawButton",
    "adminRoster",
    "claimsList",
    "addParticipantForm",
    "newName",
    "newSubfamily",
    "adminMessage",
    "adminAssignments",
    "assignmentList",
    "globalMessage",
  ].map((id) => [id, byId(id)]),
);

let currentUser = null;
let participants = [];
let myParticipant = null;
let settings = null;
let wishes = [];
let myAssignment = null;
let allAssignments = [];
let claims = [];
let viewedParticipantIds = new Set();
let isAdmin = false;
let currentView = "homeView";
let viewedAssignmentParticipantId = null;
let refreshRunning = false;
let refreshQueued = false;

function showMessage(target, text, isError = false) {
  target.textContent = text;
  target.classList.toggle("message-error", isError);
}

function showError(error, target = el.globalMessage) {
  console.error(error);
  showMessage(target, error.message || "Ocurrió un error. Intenta de nuevo.", true);
}

async function functionErrorMessage(error) {
  try {
    const body = await error.context.json();
    return body.error || error.message;
  } catch {
    return error.message;
  }
}

function formatDeadline(value) {
  if (!value) return "fecha pendiente de configurar";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(new Date(value));
}

function attendanceInfo(person) {
  if (person.excluded_at) return { icon: "✗", text: "No asistirá", className: "status-no" };
  if (person.attendance_confirmed_at) {
    return { icon: "✓", text: "Asistirá", className: "status-yes" };
  }
  return { icon: "…", text: "Sin respuesta", className: "status-pending" };
}

function isDeadlinePassed() {
  return settings?.deadline ? Date.now() >= new Date(settings.deadline).getTime() : false;
}

function addListItem(list, content, className = "") {
  const item = document.createElement("li");
  if (className) item.className = className;
  item.textContent = content;
  list.append(item);
  return item;
}

function setView(viewId) {
  currentView = viewId;
  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== viewId;
  });
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewId);
  });
  if (viewId === "drawView") markAssignmentViewed();
}

async function setAttendance(attending) {
  try {
    const { error } = await db.rpc("set_attendance", { p_attending: attending });
    if (error) throw error;
    showMessage(el.rosterMessage, "");
    await refresh();
  } catch (error) {
    showError(error, el.rosterMessage);
  }
}

function attendanceButton(label, attending, isActive, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `attend-button${isActive ? " is-active" : ""}`;
  button.textContent = label;
  button.disabled = disabled;
  button.setAttribute("aria-pressed", String(isActive));
  button.addEventListener("click", () => setAttendance(attending));
  return button;
}

function renderRoster() {
  el.rosterCard.hidden = !myParticipant && !isAdmin;
  el.rosterList.replaceChildren();
  const canChange = !isDeadlinePassed() && !settings?.draw_authorized && !myAssignment;

  participants.forEach((person) => {
    const item = document.createElement("li");
    item.className = "roster-item";
    const name = document.createElement("strong");
    name.textContent = person.name;
    const status = document.createElement("span");
    status.className = "roster-status";

    if (myParticipant && person.id === myParticipant.id) {
      const question = document.createElement("span");
      question.className = "attend-question";
      question.textContent = "¿Asistirás?";
      status.append(
        question,
        attendanceButton("✓ Sí", true, Boolean(person.attendance_confirmed_at), !canChange),
        attendanceButton("✗ No", false, Boolean(person.excluded_at), !canChange),
      );
    } else {
      const info = attendanceInfo(person);
      status.classList.add(info.className);
      status.textContent = `${info.icon} ${info.text}`;
    }

    item.append(name, status);
    el.rosterList.append(item);
  });
}

function renderWishlists() {
  el.wishlistBoard.replaceChildren();
  participants
    .filter((person) => !person.excluded_at)
    .forEach((person) => {
      const wish = wishes.find((entry) => entry.participant_id === person.id);
      const card = document.createElement("article");
      card.className = "wish-card";
      const title = document.createElement("h3");
      title.textContent = person.name;
      card.append(title);

      [
        ["Le gusta", wish?.tastes],
        ["Ideas para regalar", wish?.wishlist],
      ].forEach(([label, text]) => {
        const heading = document.createElement("h4");
        heading.textContent = label;
        const content = document.createElement("p");
        content.textContent = text?.trim() || "Todavía no agregó ideas.";
        card.append(heading, content);
      });
      el.wishlistBoard.append(card);
    });

  el.wishlistForm.hidden = !myParticipant || Boolean(myParticipant.excluded_at);
  el.wishlistGuestMessage.hidden = !el.wishlistForm.hidden;
  if (el.wishlistForm.hidden) {
    el.wishlistGuestMessage.textContent =
      "El tablero está disponible para los integrantes vinculados y activos del intercambio.";
    return;
  }
  const ownWish = wishes.find((entry) => entry.participant_id === myParticipant.id);
  el.tastesInput.value = ownWish?.tastes ?? "";
  el.wishlistInput.value = ownWish?.wishlist ?? "";
}

function renderAdmin() {
  el.adminTab.hidden = !isAdmin;
  if (!isAdmin) return;

  const eligible = participants.filter((person) => !person.excluded_at);
  const pending = eligible.filter((person) => !person.attendance_confirmed_at);
  const confirmed = eligible.length - pending.length;
  const alreadyDrawn = allAssignments.length > 0;

  el.adminStatus.textContent = alreadyDrawn
    ? "El sorteo ya está realizado y sus resultados están guardados."
    : `${confirmed} de ${eligible.length} integrantes confirmaron. Fecha límite: ${formatDeadline(settings?.deadline)}.`;
  el.closeAttendanceButton.hidden = alreadyDrawn || pending.length === 0 || !isDeadlinePassed();
  el.authorizeButton.hidden =
    alreadyDrawn || settings?.draw_authorized || pending.length > 0 || confirmed < 2;
  el.createDrawButton.hidden =
    alreadyDrawn || !settings?.draw_authorized || pending.length > 0 || confirmed < 2;

  el.adminRoster.replaceChildren();
  participants.forEach((person) => {
    const info = attendanceInfo(person);
    const resultStatus = alreadyDrawn
      ? ` · ${viewedParticipantIds.has(person.id) ? "Resultado consultado" : "Resultado pendiente"}`
      : "";
    const account = person.user_id ? "Cuenta vinculada" : "Sin cuenta";
    const item = addListItem(
      el.adminRoster,
      `${person.name} · ${person.subfamily} · ${info.icon} ${info.text} · ${account}${resultStatus}`,
      person.excluded_at ? "is-muted" : "",
    );

    if (person.user_id && !alreadyDrawn) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button";
      button.textContent = "Desvincular cuenta";
      button.addEventListener("click", async () => {
        if (!window.confirm(`¿Desvincular la cuenta de ${person.name}?`)) return;
        try {
          const { error } = await db.rpc("admin_unlink_participant", {
            p_participant_id: person.id,
          });
          if (error) throw error;
          await refresh();
        } catch (error) {
          showError(error, el.adminMessage);
        }
      });
      item.append(button);
    }
  });
  if (participants.length === 0) addListItem(el.adminRoster, "No hay integrantes registrados.");

  el.claimsList.replaceChildren();
  const pendingClaims = claims.filter((claim) => claim.status === "pending");
  if (pendingClaims.length === 0) addListItem(el.claimsList, "No hay solicitudes pendientes.");
  pendingClaims.forEach((claim) => {
    const item = document.createElement("li");
    item.className = "claim-item";
    const info = document.createElement("span");
    info.textContent = `${claim.proposed_name} (${claim.requester_email}) · ${claim.proposed_subfamily}`;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Vincular solicitud de ${claim.proposed_name}`);
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Elegir integrante";
    select.append(placeholder);
    participants
      .filter((person) => !person.user_id && !person.excluded_at)
      .forEach((person) => {
        const option = document.createElement("option");
        option.value = person.id;
        option.textContent = `${person.name} · ${person.subfamily}`;
        select.append(option);
      });
    const button = document.createElement("button");
    button.className = "button button-dark";
    button.type = "button";
    button.textContent = "Vincular";
    button.disabled = select.options.length < 2;
    button.addEventListener("click", async () => {
      if (!select.value) return;
      try {
        const { error } = await db.rpc("admin_link_claim", {
          p_claim_id: claim.id,
          p_participant_id: select.value,
        });
        if (error) throw error;
        await refresh();
      } catch (error) {
        showError(error, el.adminMessage);
      }
    });
    item.append(info, select, button);
    el.claimsList.append(item);
  });

  el.adminAssignments.hidden = !alreadyDrawn;
  el.assignmentList.replaceChildren();
  if (alreadyDrawn) {
    const namesById = new Map(participants.map((person) => [person.id, person.name]));
    allAssignments.forEach((assignment) => {
      addListItem(
        el.assignmentList,
        `${namesById.get(assignment.giver_id) ?? "Integrante"} → ${namesById.get(assignment.recipient_id) ?? "Integrante"}`,
      );
    });
  }
}

function render() {
  const authenticated = Boolean(currentUser);
  el.authPanel.hidden = authenticated || !configured;
  el.appPanel.hidden = !authenticated;
  if (!authenticated) return;

  el.accountEmail.textContent = currentUser.email ?? "";
  el.welcomeMessage.textContent = myParticipant
    ? `Hola, ${myParticipant.name}. Responde si asistirás y revisa el tablero de regalos.`
    : isAdmin
      ? "Administra la lista, las confirmaciones y el sorteo."
      : "Tu cuenta todavía no está vinculada a un integrante de la lista.";
  el.unlinkedPanel.hidden = Boolean(myParticipant) || isAdmin;
  el.participantPanel.hidden = !myParticipant;

  if (myParticipant) {
    el.myName.textContent = myParticipant.name;
    el.attendanceStatus.textContent = myParticipant.excluded_at
      ? "Estás fuera del sorteo. Si es un error y aún hay tiempo, cambia tu respuesta en Inicio."
      : myParticipant.attendance_confirmed_at
        ? "Tu asistencia está confirmada."
        : `Responde en Inicio si asistirás antes del ${formatDeadline(settings?.deadline)}.`;
    el.assignmentCard.hidden = !myAssignment;
    if (myAssignment) el.recipientName.textContent = myAssignment.recipientName;
  }

  el.drawStatus.textContent = myAssignment
    ? "El sorteo ya se realizó."
    : settings?.draw_authorized
      ? "El sorteo está autorizado. Tu resultado aparecerá aquí cuando se realice."
      : `El sorteo se habilitará cuando todos respondan y administración lo autorice. Fecha límite: ${formatDeadline(settings?.deadline)}.`;

  renderRoster();
  renderWishlists();
  renderAdmin();
}

async function applyPendingLogin() {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return;
  localStorage.removeItem(PENDING_KEY);

  let pending;
  try {
    pending = JSON.parse(raw);
  } catch {
    return;
  }

  if (pending.participantId) {
    const { error } = await db.rpc("claim_participant", {
      p_participant_id: pending.participantId,
    });
    if (error) showError(error);
  } else if (pending.missing) {
    const { error } = await db.functions.invoke("missing-member", { body: pending.missing });
    if (error) {
      showMessage(el.globalMessage, await functionErrorMessage(error), true);
    } else {
      showMessage(
        el.globalMessage,
        "Integrante no registrado: avisamos al administrador para que te agregue.",
      );
    }
  }
}

async function getOwnParticipantId() {
  const { data, error } = await db.rpc("current_participant_id");
  if (error) throw error;
  return data;
}

async function loadAll() {
  if (!configured) {
    el.configWarning.hidden = false;
    el.configWarning.textContent = supabaseLibraryAvailable
      ? "Falta configurar Supabase. Sigue los pasos de configuración del README para conectar la aplicación."
      : "No se pudo cargar la biblioteca de Supabase. Revisa tu conexión a internet e inténtalo de nuevo.";
    el.authPanel.hidden = true;
    el.appPanel.hidden = true;
    return;
  }

  el.configWarning.hidden = true;
  try {
    const { data: sessionData, error: sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    currentUser = sessionData.session?.user ?? null;
    if (!currentUser) {
      participants = [];
      myParticipant = null;
      settings = null;
      wishes = [];
      myAssignment = null;
      allAssignments = [];
      claims = [];
      isAdmin = false;
      render();
      return;
    }

    const adminResult = await db
      .from("admin_users")
      .select("user_id")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (adminResult.error) throw adminResult.error;
    isAdmin = Boolean(adminResult.data);

    let ownId = await getOwnParticipantId();
    if (ownId) {
      localStorage.removeItem(PENDING_KEY);
    } else {
      await applyPendingLogin();
      ownId = await getOwnParticipantId();
    }

    const [participantResult, settingsResult, wishesResult] = await Promise.all([
      isAdmin
        ? db.rpc("admin_roster")
        : db
            .from("participants")
            .select("id,name,active,attendance_confirmed_at,excluded_at")
            .eq("active", true)
            .order("name"),
      db.from("app_settings").select("deadline,draw_authorized").eq("id", true).maybeSingle(),
      db.from("wishlists").select("participant_id,tastes,wishlist,updated_at"),
    ]);
    [participantResult, settingsResult, wishesResult].forEach((result) => {
      if (result.error) throw result.error;
    });

    participants = participantResult.data ?? [];
    myParticipant = participants.find((person) => person.id === ownId) ?? null;
    settings = settingsResult.data;
    wishes = wishesResult.data ?? [];

    const assignmentResult = await db.from("assignments").select("giver_id,recipient_id");
    if (assignmentResult.error) throw assignmentResult.error;
    if (isAdmin) {
      allAssignments = assignmentResult.data ?? [];
      myAssignment = null;
      const viewsResult = await db.from("assignment_views").select("participant_id");
      if (viewsResult.error) throw viewsResult.error;
      viewedParticipantIds = new Set(
        (viewsResult.data ?? []).map((view) => view.participant_id),
      );
      const claimsResult = await db
        .from("participant_claims")
        .select("id,user_id,requester_email,proposed_name,proposed_subfamily,status,created_at")
        .order("created_at");
      if (claimsResult.error) throw claimsResult.error;
      claims = claimsResult.data ?? [];
    } else {
      allAssignments = [];
      viewedParticipantIds = new Set();
      claims = [];
      const assignment = assignmentResult.data?.find((entry) => entry.giver_id === ownId);
      const recipient = participants.find((person) => person.id === assignment?.recipient_id);
      myAssignment = assignment && recipient ? { ...assignment, recipientName: recipient.name } : null;
    }
    render();
    if (currentView === "drawView" && myAssignment) markAssignmentViewed();
  } catch (error) {
    showError(error);
  }
}

// Evita que varias actualizaciones simultáneas lean datos antiguos.
async function refresh() {
  if (refreshRunning) {
    refreshQueued = true;
    return;
  }
  refreshRunning = true;
  try {
    do {
      refreshQueued = false;
      await loadAll();
    } while (refreshQueued);
  } finally {
    refreshRunning = false;
  }
}

async function markAssignmentViewed() {
  if (!myParticipant || !myAssignment || viewedAssignmentParticipantId === myParticipant.id) return;
  try {
    const { error } = await db.rpc("mark_assignment_viewed");
    if (error) throw error;
    viewedAssignmentParticipantId = myParticipant.id;
  } catch (error) {
    showError(error);
  }
}

async function loadLoginNames() {
  if (!configured) return;
  const { data, error } = await db.rpc("login_names");
  if (error) {
    console.error(error);
    showMessage(
      el.authMessage,
      "No se pudo cargar la lista de integrantes. Verifica que las migraciones de Supabase estén aplicadas.",
      true,
    );
    return;
  }

  el.whoSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Elige tu nombre";
  el.whoSelect.append(placeholder);
  (data ?? []).forEach((person) => {
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = person.name;
    el.whoSelect.append(option);
  });
  const missing = document.createElement("option");
  missing.value = MISSING_OPTION;
  missing.textContent = "No estoy en la lista";
  el.whoSelect.append(missing);
}

async function signOut() {
  try {
    const { error } = await db.auth.signOut();
    if (error) throw error;
    viewedAssignmentParticipantId = null;
    el.codeForm.hidden = true;
    el.authForm.hidden = false;
    showMessage(el.globalMessage, "");
    setView("homeView");
    await refresh();
  } catch (error) {
    showError(error);
  }
}

el.whoSelect.addEventListener("change", () => {
  const missing = el.whoSelect.value === MISSING_OPTION;
  el.missingFields.hidden = !missing;
  el.missingName.required = missing;
  el.missingSubfamily.required = missing;
});

el.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const missing = el.whoSelect.value === MISSING_OPTION;
  const pending = missing
    ? {
        missing: {
          name: el.missingName.value.trim(),
          subfamily: el.missingSubfamily.value.trim(),
        },
      }
    : { participantId: el.whoSelect.value };

  showMessage(el.authMessage, "Enviando código…");
  try {
    const { error } = await db.auth.signInWithOtp({ email: el.emailInput.value.trim() });
    if (error) throw error;
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    el.authForm.hidden = true;
    el.codeForm.hidden = false;
    el.codeInput.focus();
    showMessage(el.authMessage, "Revisa tu correo e ingresa el código que recibiste.");
  } catch (error) {
    showError(error, el.authMessage);
  }
});

el.codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(el.authMessage, "Verificando…");
  try {
    const { error } = await db.auth.verifyOtp({
      email: el.emailInput.value.trim(),
      token: el.codeInput.value.trim(),
      type: "email",
    });
    if (error) throw error;
    el.codeForm.reset();
    showMessage(el.authMessage, "");
  } catch (error) {
    showError(error, el.authMessage);
  }
});

el.changeEmailButton.addEventListener("click", () => {
  localStorage.removeItem(PENDING_KEY);
  el.codeForm.hidden = true;
  el.authForm.hidden = false;
  el.codeForm.reset();
  showMessage(el.authMessage, "");
  el.whoSelect.focus();
});

el.signOutButton.addEventListener("click", signOut);
el.unlinkedSignOutButton.addEventListener("click", signOut);

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.go));
});

el.wishlistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(el.wishlistMessage, "Guardando…");
  try {
    const { error } = await db.from("wishlists").upsert({
      participant_id: myParticipant.id,
      tastes: el.tastesInput.value.trim(),
      wishlist: el.wishlistInput.value.trim(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    showMessage(el.wishlistMessage, "Tus ideas quedaron guardadas.");
    await refresh();
  } catch (error) {
    showError(error, el.wishlistMessage);
  }
});

el.refreshAdminButton.addEventListener("click", refresh);

el.closeAttendanceButton.addEventListener("click", async () => {
  try {
    const { error } = await db.rpc("close_attendance");
    if (error) throw error;
    await refresh();
  } catch (error) {
    showError(error, el.adminMessage);
  }
});

el.authorizeButton.addEventListener("click", async () => {
  try {
    const { error } = await db.rpc("authorize_draw");
    if (error) throw error;
    await refresh();
  } catch (error) {
    showError(error, el.adminMessage);
  }
});

el.createDrawButton.addEventListener("click", async () => {
  if (!window.confirm("El sorteo no se podrá cambiar después. ¿Quieres continuar?")) return;
  try {
    const { error } = await db.rpc("create_draw");
    if (error) throw error;
    await refresh();
  } catch (error) {
    showError(error, el.adminMessage);
  }
});

el.addParticipantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(el.adminMessage, "Agregando integrante…");
  try {
    const { error } = await db.from("participants").insert({
      name: el.newName.value.trim(),
      subfamily: el.newSubfamily.value.trim(),
    });
    if (error) throw error;
    el.addParticipantForm.reset();
    showMessage(el.adminMessage, "Integrante agregado.");
    await Promise.all([refresh(), loadLoginNames()]);
  } catch (error) {
    showError(error, el.adminMessage);
  }
});

if (configured) {
  db.auth.onAuthStateChange(() => {
    window.setTimeout(refresh, 0);
  });
}
loadLoginNames();
refresh();
