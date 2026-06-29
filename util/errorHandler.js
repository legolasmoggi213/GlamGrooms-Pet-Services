const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested endpoint does not exist.',
  });
};

const errorHandler = (err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
