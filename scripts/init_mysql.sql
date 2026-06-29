-- Create the database for the Capstone project.
CREATE DATABASE IF NOT EXISTS `capstone_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `capstone_db`;

-- The application sync step will create these tables automatically,
-- but the database itself must exist before the app connects.

-- Optional sample tables if you want to create them manually:
--
-- CREATE TABLE IF NOT EXISTS `Users` (
--   `id` INT AUTO_INCREMENT PRIMARY KEY,
--   `name` VARCHAR(255) NOT NULL,
--   `email` VARCHAR(255) NOT NULL UNIQUE
-- );
--
-- CREATE TABLE IF NOT EXISTS `Projects` (
--   `id` INT AUTO_INCREMENT PRIMARY KEY,
--   `title` VARCHAR(255) NOT NULL,
--   `description` TEXT,
--   `status` VARCHAR(100) NOT NULL DEFAULT 'draft',
--   `userId` INT,
--   FOREIGN KEY (`userId`) REFERENCES `Users`(`id`)
-- );
