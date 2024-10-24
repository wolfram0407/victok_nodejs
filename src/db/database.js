import mysql from "mysql2";
import { config } from "../../config.js";

const pool = mysql.createPool({
  host: config.db.host,
  user: config.db.user,
  port: config.db.port,
  database: config.db.database,
  password: config.db.password,
  dateStrings: "date",
});

export const db = pool.promise();
