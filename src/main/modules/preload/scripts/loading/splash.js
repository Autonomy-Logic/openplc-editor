document.addEventListener("DOMContentLoaded", () => {
  function updateProgressBar(progress) {
    const progressBar = document.getElementById("progressBar");

    progressBar.style.width = `${progress}%`;
  }

  let progress = 0;
  const interval = setInterval(() => {
    progress += 10;
    if (progress > 100) {
      return;
    }

    updateProgressBar(progress);
  }, 500);
});
