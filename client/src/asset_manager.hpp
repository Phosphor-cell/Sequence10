// In paper_doll.hpp or new asset_manager.hpp
class AssetManager {
public:
  Texture2D loadTexture(const std::string& path);
  void loadAllAssets();
  
  // Getters for each category
  Texture2D getBackdrop(int chapterId);
  Texture2D getCharacter(const std::string& type);
  Texture2D getEnemy(int enemyLevel);
  Texture2D getEquipment(const std::string& slot);
  Texture2D getVFX(const std::string& effectName);
  Texture2D getUIElement(const std::string& elementName);
  
private:
  std::map<std::string, Texture2D> textures;
};