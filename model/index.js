const sequelize = require('../config/database');
const User = require('./User');
const Project = require('./Project');

User.hasMany(Project, { foreignKey: 'userId' });
Project.belongsTo(User, { foreignKey: 'userId' });

const db = {
  sequelize,
  User,
  Project,
};

module.exports = db;
