// src/middlewares/validate.js

// Debe exportar EXACTAMENTE un export con nombre: validate
export const validate =
  (schema) =>
  (req, _res, next) => {
    // Si no hay schema o no es de zod, avanza
    if (!schema || typeof schema.parse !== 'function') return next();

    try {
      // 👇 AHORA sí pasamos headers
      const parsed = schema.parse({
        headers: req.headers,
        params: req.params,
        query:  req.query,
        body:   req.body,
      });

      // guardamos todo lo validado
      req.validated = parsed;

      // si Zod hizo transform en body, lo pisamos
      if (parsed.body) {
        req.body = parsed.body;
      }

      next();
    } catch (e) {
      // normalizamos el error para tu errorHandler
      e.status = 400;
      e.details = e.errors || e.issues;
      next(e);
    }
  };

export default validate;
