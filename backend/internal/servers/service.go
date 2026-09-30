package servers

import "context"

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context) ([]Server, error) {
	return s.repo.List(ctx)
}

func (s *Service) GetByID(ctx context.Context, id int64) (*Server, error) {
	if id <= 0 {
		return nil, ErrNotFound
	}
	return s.repo.GetByID(ctx, id)
}

func (s *Service) Create(ctx context.Context, input CreateServerInput) (*Server, error) {
	if err := input.NormalizeAndValidate(); err != nil {
		return nil, err
	}
	return s.repo.Create(ctx, input)
}

func (s *Service) Delete(ctx context.Context, id int64) error {
	if id <= 0 {
		return ErrNotFound
	}
	return s.repo.Delete(ctx, id)
}
