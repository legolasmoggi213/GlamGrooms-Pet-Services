const db = require('../model');

const syncDatabase = async () => {
  try {
    await db.sequelize.authenticate();
    console.log('Database connection established.');
    await db.sequelize.sync({ alter: true });
    console.log('Database synced successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Unable to sync database:', error);
    process.exit(1);
  }
};

syncDatabase();
