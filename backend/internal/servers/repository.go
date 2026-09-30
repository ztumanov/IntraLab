package servers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type Repository interface {
	List(ctx context.Context) ([]Server, error)
	GetByID(ctx context.Context, id int64) (*Server, error)
	Create(ctx context.Context, input CreateServerInput) (*Server, error)
	Delete(ctx context.Context, id int64) error
}

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) List(ctx context.Context) ([]Server, error) {
	const query = `
		SELECT id, name, hostname, ip_address, ssh_port, username, description, status, created_at, updated_at
		FROM servers
		ORDER BY created_at DESC, id DESC
	`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query servers: %w", err)
	}
	defer rows.Close()

	result := make([]Server, 0)
	for rows.Next() {
		var s Server
		if err := rows.Scan(
			&s.ID,
			&s.Name,
			&s.Hostname,
			&s.IPAddress,
			&s.SSHPort,
			&s.Username,
			&s.Description,
			&s.Status,
			&s.CreatedAt,
			&s.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan server row: %w", err)
		}
		result = append(result, s)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate server rows: %w", err)
	}

	return result, nil
}

func (r *PostgresRepository) GetByID(ctx context.Context, id int64) (*Server, error) {
	const query = `
		SELECT id, name, hostname, ip_address, ssh_port, username, description, status, created_at, updated_at
		FROM servers
		WHERE id = $1
	`

	var s Server
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&s.ID,
		&s.Name,
		&s.Hostname,
		&s.IPAddress,
		&s.SSHPort,
		&s.Username,
		&s.Description,
		&s.Status,
		&s.CreatedAt,
		&s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query server by id: %w", err)
	}

	return &s, nil
}

func (r *PostgresRepository) Create(ctx context.Context, input CreateServerInput) (*Server, error) {
	const query = `
		INSERT INTO servers (name, hostname, ip_address, ssh_port, username, description, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, name, hostname, ip_address, ssh_port, username, description, status, created_at, updated_at
	`

	var s Server
	err := r.db.QueryRowContext(
		ctx,
		query,
		input.Name,
		input.Hostname,
		input.IPAddress,
		input.SSHPort,
		input.Username,
		input.Description,
		StatusUnknown,
	).Scan(
		&s.ID,
		&s.Name,
		&s.Hostname,
		&s.IPAddress,
		&s.SSHPort,
		&s.Username,
		&s.Description,
		&s.Status,
		&s.CreatedAt,
		&s.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert server: %w", err)
	}

	return &s, nil
}

func (r *PostgresRepository) Delete(ctx context.Context, id int64) error {
	const query = `DELETE FROM servers WHERE id = $1`

	res, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("delete server: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check rows affected: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}

	return nil
}
