self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || "Notificación";
  const options = {
    body: data.body || "Tienes una nueva notificación.",
    icon: "/icon-192.png", // opcional, puedes quitarlo si no tienes ícono
    data: {
      url: data.url || "/"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      // si ya hay una pestaña abierta, la enfoca
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // si no, abre una nueva
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
