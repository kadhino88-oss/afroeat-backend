const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;

    if (!mongoURI) {
      console.error('❌ MONGO_URI est manquant dans le fichier .env');
      process.exit(1);
    }

    const conn = await mongoose.connect(mongoURI);

    console.log('✅ MongoDB connecté avec succès');
    console.log(`📦 Base de données : ${conn.connection.name}`);
    console.log(`🖥️ Hôte : ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ Erreur de connexion à MongoDB :', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;