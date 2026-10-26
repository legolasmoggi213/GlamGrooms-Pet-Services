const bcrypt = require('bcryptjs');
const { StaffAccount } = require('../models');
const { isStrongPassword } = require('../util/passwordPolicy');

const normalizeStaffEmail = (value) => String(value || '').trim().toLowerCase();
const isGmailAddress = (value) => /^[^@\s]+@gmail\.com$/.test(value);

const publicStaffAccount = (account) => ({
  id: account.id,
  username: account.username,
  name: account.name,
  email: account.email || null,
  active: account.active === true,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});

const listStaffAccounts = async (req, res, next) => {
  try {
    const accounts = await StaffAccount.findAll({ order: [['createdAt', 'DESC']] });
    res.json(accounts.map(publicStaffAccount));
  } catch (error) {
    next(error);
  }
};

const createStaffAccount = async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim().toUpperCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    const email = normalizeStaffEmail(req.body?.email);
    if (!/^[A-Z][A-Z0-9_-]{2,30}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–31 letters, numbers, underscores, or hyphens and start with a letter.' });
    }
    if (!name || name.length > 100) return res.status(400).json({ error: 'Enter a staff name up to 100 characters.' });
    if (!isGmailAddress(email)) return res.status(400).json({ error: 'Enter the staff member’s Gmail address for sign-in verification.' });
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and symbol.' });
    }
    if (await StaffAccount.findOne({ where: { username } })) {
      return res.status(409).json({ error: 'That staff username is already in use.' });
    }
    if (await StaffAccount.findOne({ where: { email } })) {
      return res.status(409).json({ error: 'That Gmail address is already assigned to a staff account.' });
    }
    const account = await StaffAccount.create({
      username,
      name,
      email,
      passwordHash: bcrypt.hashSync(password, 12),
      active: true,
    });
    return res.status(201).json({ account: publicStaffAccount(account) });
  } catch (error) {
    next(error);
  }
};

const updateStaffAccount = async (req, res, next) => {
  try {
    const account = await StaffAccount.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Staff account not found.' });
    const updates = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name || name.length > 100) return res.status(400).json({ error: 'Enter a staff name up to 100 characters.' });
      updates.name = name;
    }
    if (req.body?.email !== undefined) {
      const email = normalizeStaffEmail(req.body.email);
      if (!isGmailAddress(email)) return res.status(400).json({ error: 'Enter the staff member’s Gmail address for sign-in verification.' });
      const existing = await StaffAccount.findOne({ where: { email } });
      if (existing && String(existing.id) !== String(account.id)) {
        return res.status(409).json({ error: 'That Gmail address is already assigned to a staff account.' });
      }
      updates.email = email;
    }
    if (req.body?.active !== undefined) {
      if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Active must be true or false.' });
      updates.active = req.body.active;
    }
    if (req.body?.password) {
      const password = String(req.body.password);
      if (!isStrongPassword(password)) {
        return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, number, and symbol.' });
      }
      updates.passwordHash = bcrypt.hashSync(password, 12);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Provide an email, name, active state, or new password.' });
    await account.update(updates);
    return res.json({ account: publicStaffAccount(account) });
  } catch (error) {
    next(error);
  }
};

const deleteStaffAccount = async (req, res, next) => {
  try {
    const account = await StaffAccount.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Staff account not found.' });
    await account.destroy();
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

module.exports = { listStaffAccounts, createStaffAccount, updateStaffAccount, deleteStaffAccount };
