const {
  Model,
} = require('sequelize');
const bcrypt = require('bcrypt');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.belongsToMany(models.Game, {
        through: models.GameUser, as: 'GamesPlayed', foreignKey: 'userID', otherKey: 'gameID',
      });
      User.hasMany(models.Chat, { foreignKey: 'userID' });
      User.hasMany(models.Game, { foreignKey: 'ownerID', as: 'GamesOwned' });
      User.hasMany(models.Game, { foreignKey: 'winnerID', as: 'GamesWon' });
    }

    /**
     * @param {string} password - Plain-text password to check.
     * @returns {boolean} True when it matches the stored hash.
     */
    comparePassword(password) {
      return bcrypt.compareSync(password, this.password);
    }

    /**
     * Leaves the password hash out whenever a user is sent or put in a token.
     *
     * @returns {object} The user's fields without `password`.
     */
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
    /* eslint-disable no-param-reassign -- a hook changes the instance before it is saved */
    hooks: {
      beforeCreate: (user) => {
        user.password = bcrypt.hashSync(user.password, 12);
      },
      beforeBulkCreate: (users) => {
        users.forEach((user) => {
          user.password = bcrypt.hashSync(user.password, 12);
        });
      },
      beforeUpdate: (user) => {
        if (user.changed('password')) {
          user.password = bcrypt.hashSync(user.password, 12);
        }
      },
    },
    /* eslint-enable no-param-reassign */
  });
  return User;
};
