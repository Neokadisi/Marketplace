# Marketplace

Página donde cualquier persona crea una cuenta, publica sus servicios o productos, y tú cobras por cada publicación y por destacarla.

## Qué incluye
- Cuentas de usuario (registro e inicio de sesión, contraseñas encriptadas)
- Publicar con foto, categoría, comuna y botón de contacto por WhatsApp
- Primera publicación gratis; las siguientes y los destacados se pagan
- Cobro real con Flow (o modo de pruebas sin cobro)
- Revisión: tú apruebas o rechazas cada publicación desde el panel Admin
- Panel Admin con ingresos, publicaciones por aprobar y pagos recibidos
- Las publicaciones vencen solas y el vendedor puede renovarlas

## Correrlo en tu computador
1. Instala Node.js (versión 18 o más) y ten PostgreSQL con una base de datos vacía (por ejemplo `marketplace`).
2. En esta carpeta: `npm install`
3. Copia `.env.example` como `.env` y completa `DATABASE_URL`, `JWT_SECRET` y `ADMIN_EMAIL`.
4. `npm start` y abre http://localhost:3000
5. Regístrate con el correo que pusiste en `ADMIN_EMAIL`: esa cuenta es administradora.

Las tablas (`mk_usuarios`, `mk_publicaciones`, `mk_pagos`) se crean solas al iniciar.

## Publicarlo en internet (ejemplo con Render)
1. Sube esta carpeta a un repositorio de GitHub (el archivo `.env` NO se sube).
2. En render.com crea un **PostgreSQL** y copia su "Internal Database URL".
3. Crea un **Web Service** conectado al repositorio: Build `npm install`, Start `npm start`.
4. En "Environment" agrega las variables de `.env.example`, con estos valores:
   - `NODE_ENV=production`
   - `DATABASE_URL` (la de tu base) y `DB_SSL=true`
   - `JWT_SECRET` (un texto largo y aleatorio)
   - `BASE_URL` = la dirección pública de tu página (ej. https://tudominio.cl)
   - `ADMIN_EMAIL` = tu correo
   - `PAGO_MODO=flow`, `FLOW_API_KEY`, `FLOW_SECRET_KEY` y `FLOW_URL=https://www.flow.cl/api`
5. Para usar tu dominio (ej. www.tudominio.cl), agrégalo en "Custom Domains" del servicio y crea el registro DNS que te indique Render.

## Activar los cobros con Flow
1. Crea una cuenta de vendedor en flow.cl y completa la verificación de tu negocio.
2. Primero prueba en https://sandbox.flow.cl con sus claves de pruebas y `FLOW_URL=https://sandbox.flow.cl/api`.
3. Cuando todo funcione, cambia a las claves reales y `FLOW_URL=https://www.flow.cl/api`.

## Importante antes de abrirla al público
- Nunca uses `PAGO_MODO=simulado` en internet: cualquiera podría publicar sin pagar.
- Agrega términos y condiciones y una política de privacidad.
- Consulta con un contador cómo emitir boleta o factura por lo que cobras (SII).
- Haz copias de seguridad de la base de datos (Render las ofrece en planes de pago).
