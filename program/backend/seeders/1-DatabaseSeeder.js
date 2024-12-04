// eslint-disable-next-line import/no-extraneous-dependencies
const { faker } = require('@faker-js/faker');
const {
  User, Game, Chat, GameUser,
} = require('../models');

module.exports = {
  up: async () => {
    const users = [];
    const games = [];
    const chats = [];
    const gameUsers = [];

    // Track users in not-finished games
    const usersInUnfinishedGames = new Set();

    // Step 1: Create Users
    // 1 Admin User
    users.push({
      name: 'Admin User',
      email: 'admin@example.com',
      password: 'admin123',
      avatarURL: faker.image.avatar(),
      isAdmin: true,
      suspendedUntil: null,
      mutedUntil: null,
    });

    // 30 Regular Users
    for (let i = 0; i < 30; i++) {
      users.push({
        name: faker.person.fullName(),
        email: faker.internet.email(),
        password: faker.internet.password({ length: 10 }),
        avatarURL: faker.image.avatar(),
        isAdmin: false,
        suspendedUntil: null,
        mutedUntil: null,
      });
    }

    const insertedUsers = await User.bulkCreate(users, { returning: true });

    // Step 2: Create Games
    const statuses = [
      ...Array(3).fill('waiting'), // 3 waiting games
      ...Array(2).fill('started'), // 2 started games
      ...Array(10).fill('finished'), // 10 finished games
    ];

    // eslint-disable-next-line no-restricted-syntax
    for (const status of statuses) {
      const owner = faker.helpers.arrayElement(insertedUsers);
      games.push({
        status,
        ownerID: owner.id,
        winnerID: status === 'finished' ? faker.helpers.arrayElement(insertedUsers).id : null,
      });
    }

    const insertedGames = await Game.bulkCreate(games, { returning: true });

    // Step 3: Associate Users with Games
    const gameParticipantsMap = {}; // To track participants per game for chat messages
    // eslint-disable-next-line no-restricted-syntax
    for (const game of insertedGames) {
      const isUnfinished = game.status !== 'finished';

      // Determine available users
      const availableUsers = isUnfinished
        ? insertedUsers.filter((user) => !usersInUnfinishedGames.has(user.id))
        : insertedUsers;

      const participantCount = faker.number.int({ min: 2, max: 6 });
      const participants = faker.helpers.arrayElements(availableUsers, participantCount);

      gameParticipantsMap[game.id] = participants; // Store participants for this game

      participants.forEach((user) => {
        gameUsers.push({
          gameID: game.id,
          userID: user.id,
          isSurrendered: false,
        });

        if (isUnfinished) {
          usersInUnfinishedGames.add(user.id);
        }
      });

      // Ensure the winnerID is among the participants for finished games
      if (game.status === 'finished' && game.winnerID) {
        const validWinner = faker.helpers.arrayElement(participants);
        game.winnerID = validWinner.id;
      }
    }

    // Update games with final winnerIDs
    await Promise.all(insertedGames.map((game) => game.save()));

    // Step 4: Create Chats (20 messages per game)
    // eslint-disable-next-line no-restricted-syntax
    for (const game of insertedGames) {
      const participants = gameParticipantsMap[game.id]; // Get participants for this game
      for (let i = 0; i < 20; i++) {
        chats.push({
          message: faker.lorem.sentence(),
          userID: faker.helpers.arrayElement(participants).id, // Random participant sends message
          gameID: game.id,
        });
      }
    }

    // Insert GameUser Relationships and Chats
    await GameUser.bulkCreate(gameUsers);
    await Chat.bulkCreate(chats);
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('Chats', null, {});
    await queryInterface.bulkDelete('GameUsers', null, {});
    await queryInterface.bulkDelete('Games', null, {});
    await queryInterface.bulkDelete('Users', null, {});
  },
};
