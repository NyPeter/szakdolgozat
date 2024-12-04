const {
  Model,
} = require('sequelize');
// eslint-disable-next-line import/no-extraneous-dependencies
const bcrypt = require('bcrypt');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.belongsToMany(models.Game, { through: models.GameUser, as: 'GamesPlayed' });
      User.hasMany(models.Chat, { foreignKey: 'userID' });
      User.hasMany(models.Game, { foreignKey: 'ownerID', as: 'GamesOwned' });
      User.hasMany(models.Game, { foreignKey: 'winnerID', as: 'GamesWon' });
    }

    comparePassword(password) {
      return bcrypt.compareSync(password, this.password);
    }

    toJSON() {
      const data = this.get();
      if (Object.prototype.hasOwnProperty.call(data, 'password')) {
        delete data.password;
      }
      return data;
    }
  }
  User.init({
    name: {
      allowNull: false,
      unique: true,
      type: DataTypes.STRING,
    },
    email: {
      allowNull: false,
      unique: true,
      type: DataTypes.STRING,
      validate: {
        isEmail: true,
      },
    },
    password: {
      allowNull: false,
      type: DataTypes.STRING,
      validate: {
        len: [8, 128],
      },
    },
    avatarURL: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isAdmin: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    suspendedUntil: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    mutedUntil: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: 'User',
    hooks: {
      beforeCreate: (user) => {
        // eslint-disable-next-line no-param-reassign
        user.password = bcrypt.hashSync(user.password, 12);
      },
      beforeBulkCreate: (users) => {
        users.forEach((user) => {
          // eslint-disable-next-line no-param-reassign
          user.password = bcrypt.hashSync(user.password, 12);
        });
      },
    },
  });
  return User;
};
