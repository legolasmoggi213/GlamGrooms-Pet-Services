const { User, Project } = require('../model');


const getStatus = async (req, res, next) => {
  try {
    const users = await User.count();
    const projects = await Project.count();

    res.json({
      status: 'ok',
      message: 'Capstone backend is running',
      users,
      projects,
    });
  } catch (error) {
    next(error);
  }
};

const listUsers = async (req, res, next) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
};

const listProjects = async (req, res, next) => {
  try {
    const projects = await Project.findAll({ include: User });
    res.json(projects);
  } catch (error) {
    next(error);
  }
};


const createProject = async (req, res, next) => {
  try {
    const project = await Project.create(req.body);
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStatus,
  listUsers,
  createUser,
  listProjects,
  createProject,
};
