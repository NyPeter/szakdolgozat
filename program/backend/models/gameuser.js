const {
  Model,
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class GameUser extends Model {
    static associate() {
      // define association here
    }
  }
  GameUser.init({
    isSurrendered: DataTypes.BOOLEAN,
    gameID: DataTypes.INTEGER,
    userID: DataTypes.INTEGER,
  }, {
    sequelize,
    modelName: 'GameUser',
  });
  return GameUser;
};
