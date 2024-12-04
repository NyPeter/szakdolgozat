const {
  Model,
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Game extends Model {
    static associate(models) {
      Game.belongsToMany(models.User, { through: models.GameUser, as: 'Players' });
      Game.hasMany(models.Chat, { foreignKey: 'gameID' });
      Game.belongsTo(models.User, { foreignKey: 'ownerID', as: 'Owner' });
      Game.belongsTo(models.User, { foreignKey: 'winnerID', as: 'Winner' });
    }
  }
  Game.init({
    status: DataTypes.ENUM('waiting', 'started', 'finished'),
    ownerID: DataTypes.INTEGER,
    winnerID: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'Game',
  });
  return Game;
};
