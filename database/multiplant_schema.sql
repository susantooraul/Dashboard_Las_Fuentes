CREATE TABLE plants (
  plant_id VARCHAR(50) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  state_name VARCHAR(80) NULL,
  is_active BIT NOT NULL DEFAULT 1
);

CREATE TABLE plant_connections (
  connection_id INT IDENTITY PRIMARY KEY,
  plant_id VARCHAR(50) NOT NULL,
  connection_name VARCHAR(80) NOT NULL,
  server_name VARCHAR(120) NOT NULL,
  database_name VARCHAR(120) NOT NULL,
  username_name VARCHAR(120) NULL,
  encrypted_password VARBINARY(MAX) NULL,
  role_name VARCHAR(30) NOT NULL,
  is_active BIT NOT NULL DEFAULT 1,
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE substations (
  substation_id INT IDENTITY PRIMARY KEY,
  plant_id VARCHAR(50) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE transformers (
  transformer_id INT IDENTITY PRIMARY KEY,
  plant_id VARCHAR(50) NOT NULL,
  substation_id INT NOT NULL,
  code VARCHAR(50) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  capacity_kva DECIMAL(18,2) NULL,
  menu_order INT NOT NULL DEFAULT 1,
  is_active BIT NOT NULL DEFAULT 1,
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id),
  FOREIGN KEY (substation_id) REFERENCES substations(substation_id)
);

CREATE TABLE groupings (
  grouping_id INT IDENTITY PRIMARY KEY,
  plant_id VARCHAR(50) NOT NULL,
  grouping_type VARCHAR(50) NOT NULL,
  code VARCHAR(50) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  menu_order INT NOT NULL DEFAULT 1,
  is_active BIT NOT NULL DEFAULT 1,
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE circuits (
  circuit_id INT IDENTITY PRIMARY KEY,
  plant_id VARCHAR(50) NOT NULL,
  transformer_id INT NOT NULL,
  grouping_id INT NOT NULL,
  source_code VARCHAR(80) NULL,
  display_name VARCHAR(120) NOT NULL,
  rated_amps DECIMAL(18,2) NULL,
  description_text VARCHAR(255) NULL,
  is_active BIT NOT NULL DEFAULT 1,
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id),
  FOREIGN KEY (transformer_id) REFERENCES transformers(transformer_id),
  FOREIGN KEY (grouping_id) REFERENCES groupings(grouping_id)
);
