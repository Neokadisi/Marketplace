-- Tablas del marketplace (prefijo mk_ para no chocar con otras tablas, por ejemplo las de tu tienda)
CREATE TABLE IF NOT EXISTS mk_usuarios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'usuario',
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mk_publicaciones (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES mk_usuarios(id),
  titulo TEXT NOT NULL,
  categoria TEXT NOT NULL,
  precio INT,
  comuna TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  imagen TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  dias INT NOT NULL DEFAULT 30,
  quiere_destacar BOOLEAN NOT NULL DEFAULT false,
  destacada_hasta TIMESTAMPTZ,
  vence TIMESTAMPTZ,
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mk_pub_estado ON mk_publicaciones (estado, vence);
CREATE TABLE IF NOT EXISTS mk_pagos (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES mk_usuarios(id),
  publicacion_id INT REFERENCES mk_publicaciones(id),
  tipo TEXT NOT NULL,
  concepto TEXT NOT NULL,
  monto INT NOT NULL,
  medio TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  orden TEXT UNIQUE NOT NULL,
  token TEXT,
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  pagado_en TIMESTAMPTZ
);
