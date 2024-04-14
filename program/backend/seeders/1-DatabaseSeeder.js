const { faker } = require('@faker-js/faker');
// TODO: Import models here
// const { ... } = require("../models");

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // TODO: Implement database seed here

    console.log('DatabaseSeeder completed.');
  },

  down: async (queryInterface, Sequelize) => {},
};
