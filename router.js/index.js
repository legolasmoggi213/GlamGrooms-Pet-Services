const express = require('express');
const {
  getStatus,
  listUsers,
  createUser,
  listProjects,
  createProject,
} = require('../controller.js');

const router = express.Router();

router.get('/status', getStatus);
router.get('/users', listUsers);
router.post('/users', createUser);
router.get('/projects', listProjects);
router.post('/projects', createProject);

module.exports = router;
