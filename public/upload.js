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
