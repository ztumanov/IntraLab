package config

import (
	"fmt"
	"os"
)

type Config struct {
	AppEnv   string
	APIPort  string
	DBHost   string
	DBPort   string
	DBUser   string
	DBPass   string
	DBName   string
	DBSSL    string
}

func Load() (*Config, error) {
	cfg := &Config{
		AppEnv:  getEnv("APP_ENV", "development"),
		APIPort: getEnv("API_PORT", "8080"),
		DBHost:  getEnv("SQL_HOST", "localhost"),
		DBPort:  getEnv("SQL_PORT", "5432"),
		DBUser:  getEnv("SQL_USER", ""),
		DBPass:  getEnv("SQL_PASSWORD", ""),
		DBName:  getEnv("SQL_DB_NAME", "infralab"),
		DBSSL:   getEnv("SQL_SSLMODE", "disable"),
	}

	if cfg.DBUser == "" {
		return nil, fmt.Errorf("SQL_USER environment variable is required")
	}

	return cfg, nil
}

func (c *Config) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		c.DBHost, c.DBPort, c.DBUser, c.DBPass, c.DBName, c.DBSSL,
	)
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return fallback
}
