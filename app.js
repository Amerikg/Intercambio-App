const STORAGE_KEY = "intercambio-familiar-v1";

const nameForm = document.querySelector("#nameForm");
const nameInput = document.querySelector("#nameInput");
const formMessage = document.querySelector("#formMessage");
const participantList = document.querySelector("#participantList");
const participantCount = document.querySelector("#participantCount");
const participantHint = document.querySelector("#participantHint");
const drawButton = document.querySelector("#drawButton");
const setupPanel = document.querySelector("#setupPanel");
const drawPanel = document.querySelector("#drawPanel");
const participantSelect = document.querySelector("#participantSelect");
const revealButton = document.querySelector("#revealButton");
const result = document.querySelector("#result");
const recipientName = document.querySelector("#recipientName");
const hideResultButton = document.querySelector("#hideResultButton");
const editButton = document.querySelector("#editButton");

let participants = [];
let assignments = null;

function isValidSavedDraw(saved) {
  if (!Array.isArray(saved?.participants) || !saved.assignments) return false;

  const names = saved.participants;
  const recipients = names.map((name) => saved.assignments[name]);
  return (
    names.length >= 2 &&
    names.every((name) => typeof name === "string" && name.trim() === name) &&
    new Set(names.map((name) => name.toLocaleLowerCase())).size === names.length &&
    recipients.every((name) => typeof name === "string" && names.includes(name)) &&
    new Set(recipients).size === names.length &&
    names.every((name) => saved.assignments[name] !== name)
  );
}

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (isValidSavedDraw(saved)) {
      participants = saved.participants;
      assignments = saved.assignments;
      return;
    }

    if (Array.isArray(saved?.participants)) {
      participants = saved.participants.filter(
        (name) => typeof name === "string" && name.trim() === name,
      );
    }
  } catch {
    participants = [];
    assignments = null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ participants, assignments }));
  } catch {
    formMessage.textContent = "No se pudo guardar en este dispositivo.";
  }
}

function renderParticipants() {
  participantList.replaceChildren();

  participants.forEach((name, index) => {
    const item = document.createElement("li");
    item.className = "participant";

    const label = document.createElement("span");
    label.textContent = name;

    const removeButton = document.createElement("button");
    removeButton.className = "remove-button";
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Quitar a ${name}`);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      participants.splice(index, 1);
      formMessage.textContent = "";
      saveState();
      render();
    });

    item.append(label, removeButton);
    participantList.append(item);
  });

  participantCount.textContent = String(participants.length);
  participantHint.textContent = participants.length < 2 ? "Mínimo 2" : "Listos para sortear";
  drawButton.disabled = participants.length < 2;
}

function renderSelect() {
  participantSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Elige tu nombre";
  participantSelect.append(placeholder);

  participants.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    participantSelect.append(option);
  });
}

function render() {
  const hasDraw = assignments !== null;
  setupPanel.hidden = hasDraw;
  drawPanel.hidden = !hasDraw;
  if (hasDraw) renderSelect();
  else renderParticipants();
}

function shuffledNames(names) {
  const shuffled = [...names];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex], shuffled[index]];
  }
  return shuffled;
}

function createAssignments(names) {
  const shuffled = shuffledNames(names);
  const offset = 1 + Math.floor(Math.random() * (shuffled.length - 1));

  return Object.fromEntries(
    shuffled.map((name, index) => [name, shuffled[(index + offset) % shuffled.length]]),
  );
}

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;

  const alreadyExists = participants.some(
    (participant) => participant.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (alreadyExists) {
    formMessage.textContent = "Ese nombre ya está en la lista.";
    nameInput.focus();
    return;
  }

  participants.push(name);
  formMessage.textContent = "";
  nameInput.value = "";
  saveState();
  renderParticipants();
  nameInput.focus();
});

drawButton.addEventListener("click", () => {
  if (participants.length < 2) return;
  assignments = createAssignments(participants);
  saveState();
  result.hidden = true;
  participantSelect.value = "";
  revealButton.disabled = true;
  render();
});

participantSelect.addEventListener("change", () => {
  result.hidden = true;
  revealButton.disabled = !participantSelect.value;
});

revealButton.addEventListener("click", () => {
  const recipient = assignments?.[participantSelect.value];
  if (!recipient) return;
  recipientName.textContent = recipient;
  result.hidden = false;
});

hideResultButton.addEventListener("click", () => {
  result.hidden = true;
  participantSelect.value = "";
  revealButton.disabled = true;
  participantSelect.focus();
});

editButton.addEventListener("click", () => {
  if (!window.confirm("¿Quieres editar los nombres y hacer un sorteo nuevo?")) return;
  assignments = null;
  result.hidden = true;
  saveState();
  render();
});

loadSavedState();
render();
