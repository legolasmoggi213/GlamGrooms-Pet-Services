const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested endpoint does not exist.',
  });
};

// Maps Sequelize errors to clean client-facing responses.
const errorHandler = (err, req, res, next) => {
  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors ? err.errors.map((e) => e.message) : [err.message],
    });
  }

  console.error(err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
  });
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
