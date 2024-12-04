const {
  Model,
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class GameUser extends Model {
    static associate(models) {
      GameUser.belongsTo(models.Game, { foreignKey: 'gameID' });
      GameUser.belongsTo(models.User, { foreignKey: 'userID' });
    }
  }
  GameUser.init({
    isSurrendered: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    gameID: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Games', key: 'id' },
    },
    userID: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' },
    },
  }, {
    sequelize,
    modelName: 'GameUser',
  });
  return GameUser;
};
