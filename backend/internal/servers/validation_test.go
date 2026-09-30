package servers

import "testing"

func TestCreateServerValidation(t *testing.T) {
	valid := CreateServerInput{
		Name:        "web-01",
		Hostname:    "web-01",
		IPAddress:   "10.10.10.11",
		SSHPort:     22,
		Username:    "admin",
		Description: "Web server",
	}
	if err := valid.NormalizeAndValidate(); err != nil {
		t.Fatalf("expected valid input, got error: %v", err)
	}

	invalidCases := []struct {
		name  string
		input CreateServerInput
	}{
		{
			name: "empty name",
			input: CreateServerInput{
				Name:      "",
				Hostname:  "web-01",
				IPAddress: "10.10.10.11",
				SSHPort:   22,
				Username:  "admin",
			},
		},
		{
			name: "empty hostname",
			input: CreateServerInput{
				Name:      "web-01",
				Hostname:  "   ",
				IPAddress: "10.10.10.11",
				SSHPort:   22,
				Username:  "admin",
			},
		},
		{
			name: "invalid IP",
			input: CreateServerInput{
				Name:      "web-01",
				Hostname:  "web-01",
				IPAddress: "999.999.999.999",
				SSHPort:   22,
				Username:  "admin",
			},
		},
		{
			name: "invalid SSH port zero",
			input: CreateServerInput{
				Name:      "web-01",
				Hostname:  "web-01",
				IPAddress: "10.10.10.11",
				SSHPort:   0,
				Username:  "admin",
			},
		},
		{
			name: "invalid SSH port out of range",
			input: CreateServerInput{
				Name:      "web-01",
				Hostname:  "web-01",
				IPAddress: "10.10.10.11",
				SSHPort:   70000,
				Username:  "admin",
			},
		},
		{
			name: "empty username",
			input: CreateServerInput{
				Name:      "web-01",
				Hostname:  "web-01",
				IPAddress: "10.10.10.11",
				SSHPort:   22,
				Username:  "",
			},
		},
	}

	for _, tc := range invalidCases {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.input.NormalizeAndValidate(); err == nil {
				t.Fatalf("expected validation error for case %q, got nil", tc.name)
			}
		})
	}
}
