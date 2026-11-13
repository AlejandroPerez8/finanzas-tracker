/*
 * Aplica el tema guardado antes de pintar, para que la app no parpadee al abrir.
 * La preferencia vive en los datos de la app; aquí solo se lee su copia en localStorage.
 * Valores: 'claro', 'oscuro' o 'auto' (sigue al sistema).
 */
(function () {
  let tema = 'auto';
  try {
    tema = localStorage.getItem('finanzas-tema') || 'auto';
  } catch {
    // Sin localStorage se sigue al sistema.
  }
  if (tema === 'claro') document.documentElement.setAttribute('data-theme', 'light');
  else if (tema === 'oscuro') document.documentElement.setAttribute('data-theme', 'dark');
})();
