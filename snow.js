(() => {
  const container = document.querySelector(".snow");
  if (!container || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const count = window.innerWidth < 600 ? 22 : 40;
  for (let index = 0; index < count; index += 1) {
    const flake = document.createElement("i");
    const size = 3 + Math.random() * 5;
    flake.style.left = `${Math.random() * 100}%`;
    flake.style.width = flake.style.height = `${size}px`;
    flake.style.opacity = String(0.35 + Math.random() * 0.5);
    flake.style.animationDuration = `${9 + Math.random() * 10}s`;
    flake.style.animationDelay = `${-Math.random() * 18}s`;
    flake.style.setProperty("--sway", `${Math.round(Math.random() * 60 - 30)}px`);
    container.append(flake);
  }
})();
