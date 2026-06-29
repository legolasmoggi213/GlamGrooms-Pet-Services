const path = require('path');
const dotenv = require('dotenv');
const { Sequelize } = require('sequelize');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const sequelize = new Sequelize(
  process.env.DB_NAME || 'capstone_db',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || 'admin',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    dialect: 'mysql',
    logging: false,
  }
);

module.exports = sequelize;
