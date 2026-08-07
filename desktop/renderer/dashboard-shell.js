(function () {
  document.addEventListener('click', function (event) {
    var button = event.target.closest('.native-dashboard-link[data-view]');
    if (!button) return;
    document.querySelectorAll('.native-dashboard-link').forEach(function (item) { item.classList.toggle('active', item === button); });
  });
}());
