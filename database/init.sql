-- Crear la base de datos
CREATE DATABASE inventario_negocio;

-- Conectarse a la base de datos
\c inventario_negocio;

-- Tabla de negocios
CREATE TABLE negocios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    direccion TEXT,
    telefono VARCHAR(20),
    email VARCHAR(255),
    ruc_nit VARCHAR(50),
    logo_url TEXT,
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT NOW()
);

-- Tabla de usuarios/empleados
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER REFERENCES negocios(id),
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    rol VARCHAR(20) DEFAULT 'trabajador', -- 'super_admin', 'admin', 'trabajador'
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT NOW(),
    UNIQUE(email, negocio_id)
);

-- Tabla de categorías por negocio
CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER REFERENCES negocios(id),
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT
);

-- Tabla de productos
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER REFERENCES negocios(id),
    codigo_ean VARCHAR(13),
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    precio_compra DECIMAL(10,2),
    precio_venta DECIMAL(10,2) NOT NULL,
    stock_actual INTEGER DEFAULT 0,
    stock_minimo INTEGER DEFAULT 5,
    categoria_id INTEGER REFERENCES categorias(id),
    activo BOOLEAN DEFAULT true,
    fecha_creacion TIMESTAMP DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP DEFAULT NOW(),
    UNIQUE(codigo_ean, negocio_id)
);

-- Tabla de ventas
CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER REFERENCES negocios(id),
    numero_factura VARCHAR(50) NOT NULL,
    fecha_venta TIMESTAMP DEFAULT NOW(),
    cliente_nombre VARCHAR(255),
    cliente_documento VARCHAR(50),
    cliente_direccion TEXT,
    cliente_telefono VARCHAR(20),
    subtotal DECIMAL(10,2) NOT NULL,
    iva DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id),
    estado VARCHAR(20) DEFAULT 'completada',
    metodo_pago VARCHAR(50) DEFAULT 'efectivo'
);

-- Tabla de detalles de venta
CREATE TABLE detalle_venta (
    id SERIAL PRIMARY KEY,
    venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id INTEGER REFERENCES productos(id),
    cantidad INTEGER NOT NULL,
    precio_unitario DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL
);

-- Tabla de secuencias de facturación por negocio
CREATE TABLE secuencias_factura (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER REFERENCES negocios(id) UNIQUE,
    prefijo VARCHAR(10) DEFAULT 'FAC',
    siguiente_numero INTEGER DEFAULT 1,
    resolucion_dian VARCHAR(100),
    fecha_resolucion DATE
);

-- Insertar datos iniciales
-- 1. Crear negocio principal
INSERT INTO negocios (nombre, direccion, telefono, email, ruc_nit) VALUES 
('Mi Negocio Principal', 'Dirección principal', '3001234567', 'info@minegocio.com', '123456789-0');

-- 2. Crear super admin (sin negocio asignado)
INSERT INTO usuarios (nombre, email, password, rol) VALUES 
('Super Administrador', 'superadmin@system.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'super_admin');

-- 3. Crear admin para el negocio principal
INSERT INTO usuarios (negocio_id, nombre, email, password, rol) VALUES 
(1, 'Administrador Principal', 'admin@negocio.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin');

-- 4. Crear secuencia de facturación para el negocio principal
INSERT INTO secuencias_factura (negocio_id, prefijo, siguiente_numero, resolucion_dian) VALUES 
(1, 'FAC', 1, 'Resolución DIAN 18764000000001');

-- 5. Insertar categorías para el negocio principal
INSERT INTO categorias (negocio_id, nombre, descripcion) VALUES 
(1, 'General', 'Productos sin categoría específica'),
(1, 'Tecnología', 'Productos electrónicos y tecnológicos'),
(1, 'Hogar', 'Artículos para el hogar');

-- 6. Insertar algunos productos de ejemplo
INSERT INTO productos (negocio_id, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id) VALUES 
(1, '1234567890123', 'Laptop HP 15"', 'Laptop HP 15 pulgadas, 8GB RAM, 256GB SSD', 1200000, 1500000, 10, 2, 2),
(1, '1234567890124', 'Mouse Inalámbrico', 'Mouse ergonómico inalámbrico', 25000, 45000, 25, 5, 2),
(1, '1234567890125', 'Silla Oficina', 'Silla ergonómica para oficina', 180000, 250000, 8, 2, 3);

-- Crear índices para mejor performance
CREATE INDEX idx_usuarios_negocio ON usuarios(negocio_id);
CREATE INDEX idx_productos_negocio ON productos(negocio_id);
CREATE INDEX idx_ventas_negocio ON ventas(negocio_id);
CREATE INDEX idx_ventas_fecha ON ventas(fecha_venta);
CREATE INDEX idx_productos_ean ON productos(codigo_ean);