const input = document.querySelector("#htmlFile");
const dropzone = document.querySelector(".dropzone");
const title = document.querySelector(".drop-title");

if (input && dropzone && title) {
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    dropzone.classList.toggle("has-file", Boolean(file));
    if (file) title.textContent = file.name;
  });
}

document.querySelectorAll(".replace-form").forEach((form) => {
  const replaceInput = form.querySelector(".replace-input");
  const replaceSubmit = form.querySelector(".replace-submit");
  const replaceButton = form.querySelector(".replace-button");

  if (!replaceInput || !replaceSubmit || !replaceButton) return;

  replaceInput.addEventListener("change", () => {
    const file = replaceInput.files?.[0];
    replaceSubmit.disabled = !file;
    replaceButton.textContent = file ? file.name : "Choose";
  });
});
