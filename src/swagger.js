// src/swagger.js
import swaggerAutogen from 'swagger-autogen'

const outputFile = './src/swagger_output.json'

const endpointsFiles = [
  './src/modules/areas/routes.area.js',
  './src/modules/Catalogos/routes.catalog.js',
  './src/modules/teams/routes.team.js',
  './src/modules/Ticket/routes.ticket.js',
  './src/modules/chats/routes.chat.js',
  './src/modules/notifications/routes.notification.js',
]

const doc = {
  info: {
    title: 'Tareas y Proyectos API',
    description:
      'Backend: Areas, Catalogos, Teams, Tickets, Chats, Notifications',
    version: '1.0.0',
  },
  host: process.env.SWAGGER_HOST || 'localhost:4000',
  basePath: '/tikets',
  schemes: ['http'],
  consumes: ['application/json'],
  produces: ['application/json'],

  securityDefinitions: {
    bearerAuth: {
      type: 'apiKey',
      name: 'Authorization',
      in: 'header',
      description: 'Bearer <token>',
    },
  },
  security: [{ bearerAuth: [] }],

  tags: [
    { name: 'Areas', description: 'Áreas' },
    { name: 'Catalog', description: 'Catálogos' },
    { name: 'Teams', description: 'Teams' },
    { name: 'Tickets', description: 'Tickets' },
    { name: 'Chats', description: 'Chats y mensajes' },
    { name: 'Notifications', description: 'Notificaciones' },
  ],
}

swaggerAutogen()(outputFile, endpointsFiles, doc).then(() => {
  console.log('✅ Swagger generado:', outputFile)
})
