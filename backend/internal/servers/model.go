package servers

import (
	"errors"
	"net"
	"strings"
	"time"
)

type Status string

const (
	StatusUnknown Status = "unknown"
	StatusOnline  Status = "online"
	StatusOffline Status = "offline"
)

var (
	ErrNotFound   = errors.New("server not found")
	ErrValidation = errors.New("validation failed")
)

type Server struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Hostname    string    `json:"hostname"`
	IPAddress   string    `json:"ip_address"`
	SSHPort     int       `json:"ssh_port"`
	Username    string    `json:"username"`
	Description string    `json:"description"`
	Status      Status    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type CreateServerInput struct {
	Name        string `json:"name"`
	Hostname    string `json:"hostname"`
	IPAddress   string `json:"ip_address"`
	SSHPort     int    `json:"ssh_port"`
	Username    string `json:"username"`
	Description string `json:"description"`
}

type ValidationError struct {
	Fields map[string]string `json:"details"`
}

func (v *ValidationError) Error() string {
	return ErrValidation.Error()
}

func (in *CreateServerInput) NormalizeAndValidate() error {
	in.Name = strings.TrimSpace(in.Name)
	in.Hostname = strings.TrimSpace(in.Hostname)
	in.IPAddress = strings.TrimSpace(in.IPAddress)
	in.Username = strings.TrimSpace(in.Username)
	in.Description = strings.TrimSpace(in.Description)

	fields := make(map[string]string)

	if in.Name == "" {
		fields["name"] = "name cannot be empty"
	} else if len(in.Name) > 128 {
		fields["name"] = "name cannot exceed 128 characters"
	}

	if in.Hostname == "" {
		fields["hostname"] = "hostname cannot be empty"
	} else if len(in.Hostname) > 253 {
		fields["hostname"] = "hostname cannot exceed 253 characters"
	}

	if in.IPAddress == "" {
		fields["ip_address"] = "ip_address cannot be empty"
	} else if net.ParseIP(in.IPAddress) == nil {
		fields["ip_address"] = "ip_address must be a valid IPv4 or IPv6 address"
	}

	if in.SSHPort < 1 || in.SSHPort > 65535 {
		fields["ssh_port"] = "ssh_port must be in range 1-65535"
	}

	if in.Username == "" {
		fields["username"] = "username cannot be empty"
	} else if len(in.Username) > 64 {
		fields["username"] = "username cannot exceed 64 characters"
	}

	if len(fields) > 0 {
		return &ValidationError{Fields: fields}
	}

	return nil
}
