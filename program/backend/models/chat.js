const {
  Model,
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Chat extends Model {
    static associate(models) {
      Chat.belongsTo(models.User, { foreignKey: 'userID' });
      Chat.belongsTo(models.Game, { foreignKey: 'gameID' });
    }
  }
  Chat.init({
    message: DataTypes.TEXT,
    userID: DataTypes.INTEGER,
    gameID: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Chat',
  });
  return Chat;
};
