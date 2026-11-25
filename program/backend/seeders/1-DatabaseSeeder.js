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

    // A user may be in only one waiting or started game.
    const usersInUnfinishedGames = new Set();

    users.push({
      name: 'Admin User',
      email: 'admin@example.com',
      password: 'admin123',
      avatarURL: '/uploads/default_avatar.jpg',
      isAdmin: true,
      suspendedUntil: null,
      mutedUntil: null,
    });

    for (let i = 0; i < 30; i++) {
      users.push({
        name: faker.person.fullName(),
        email: faker.internet.email(),
        password: faker.internet.password({ length: 10 }),
        avatarURL: '/uploads/default_avatar.jpg',
        isAdmin: false,
        suspendedUntil: null,
        mutedUntil: null,
      });
    }

    const insertedUsers = await User.bulkCreate(users, { returning: true });

    const statuses = [
      ...Array(3).fill('waiting'),
      ...Array(2).fill('started'),
      ...Array(10).fill('finished'),
    ];

    for (const status of statuses) {
      const owner = faker.helpers.arrayElement(insertedUsers);
      if (status !== 'finished') {
        usersInUnfinishedGames.add(owner);
      }
      games.push({
        status,
        ownerID: owner.id,
        winnerID: status === 'finished' ? faker.helpers.arrayElement(insertedUsers).id : null,
      });
    }

    const insertedGames = await Game.bulkCreate(games, { returning: true });

    const gameParticipantsMap = {};
    for (const game of insertedGames) {
      const isUnfinished = game.status !== 'finished';

      const availableUsers = isUnfinished
        ? insertedUsers.filter((user) => !usersInUnfinishedGames.has(user.id))
        : insertedUsers;

      const participantCount = faker.number.int({ min: 1, max: 5 });
      const participants = faker.helpers.arrayElements(availableUsers, participantCount);
      participants.unshift(insertedUsers.find((u) => u.id === game.ownerID));

      gameParticipantsMap[game.id] = participants;

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

      // The winner picked above was any user; it must be one of the players.
      if (game.status === 'finished' && game.winnerID) {
        const validWinner = faker.helpers.arrayElement(participants);
        game.winnerID = validWinner.id;
      }
    }

    await Promise.all(insertedGames.map((game) => game.save()));

    for (const game of insertedGames) {
      const participants = gameParticipantsMap[game.id];
      for (let i = 0; i < 20; i++) {
        chats.push({
          message: faker.lorem.sentence(),
          userID: faker.helpers.arrayElement(participants).id,
          gameID: game.id,
        });
      }
    }

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
