const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const isStaffOrAdminEmail = async (email, { Admin, StaffAccount, adminEmail }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  if (normalizedEmail === normalizeEmail(adminEmail)) return true;

  const [admins, staffAccounts] = await Promise.all([
    Admin.findAll(),
    StaffAccount.findAll(),
  ]);
  return [...admins, ...staffAccounts].some((account) => (
    [account.email, account.username].some((value) => normalizeEmail(value) === normalizedEmail)
  ));
};

module.exports = { isStaffOrAdminEmail };
