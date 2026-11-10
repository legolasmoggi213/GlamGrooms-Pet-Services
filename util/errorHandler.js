const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested endpoint does not exist.',
  });
};

// Maps Sequelize errors to clean client-facing responses.
const errorHandler = (err, req, res, next) => {
  if (!err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  if (Number(err.code) === 8 || err.code === 'RESOURCE_EXHAUSTED') {
    return res.status(503).json({
      error: 'The booking database has reached its Firestore quota. Please try again later or contact the administrator.',
      message: 'The booking database has reached its Firestore quota. Please try again later or contact the administrator.',
    });
  }

  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors ? err.errors.map((e) => e.message) : [err.message],
    });
  }

  if (err.status && err.status < 500) {
    return res.status(err.status).json({
      error: err.message || 'Request validation failed',
      message: err.message || 'Request validation failed',
    });
  }

  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    message: err.message || 'Internal Server Error',
  });
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
