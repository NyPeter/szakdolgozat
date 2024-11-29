const {
  Model,
} = require('sequelize');
// eslint-disable-next-line import/no-extraneous-dependencies
const bcrypt = require('bcrypt');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.belongsToMany(models.Game, { through: models.GameUser, foreignKey: 'userID' });
      User.hasMany(models.Chat, { foreignKey: 'userID' });
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
    name: DataTypes.STRING,
    email: DataTypes.STRING,
    password: DataTypes.STRING,
    avatarURL: DataTypes.STRING,
    isAdmin: DataTypes.BOOLEAN,
    suspendedUntil: DataTypes.DATE,
    mutedUntil: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'User',
    hooks: {
      beforeCreate: (user) => {
        // eslint-disable-next-line no-param-reassign
        user.password = bcrypt.hashSync(user.password, 12);
      },
    },
  });
  return User;
};
