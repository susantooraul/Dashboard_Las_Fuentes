CREATE TABLE measurements (
  id INTEGER PRIMARY KEY,
  section VARCHAR(80) NOT NULL,
  system_name VARCHAR(80) NOT NULL,
  timestamp DATETIME NOT NULL,
  kw FLOAT NOT NULL,
  kwh FLOAT NOT NULL,
  kvarh FLOAT NOT NULL,
  voltage FLOAT NOT NULL,
  current FLOAT NOT NULL,
  power_factor FLOAT NOT NULL,
  cost_mxn FLOAT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'normal'
);
