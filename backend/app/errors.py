"""Erros públicos claros e logs sem corpo, credenciais ou valores da requisição."""
import logging
import traceback
from uuid import uuid4

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

logger = logging.getLogger('uvicorn.error')


def install_error_handling(app):
    def response(request, status, detail, code, headers=None):
        request_id = request.state.request_id
        return JSONResponse(status_code=status, content={'detail': detail, 'code': code, 'request_id': request_id}, headers={**(headers or {}), 'X-Request-ID': request_id})

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        missing = exc.status_code == 404 and exc.detail == 'Not Found'
        detail = 'Recurso indisponível nesta versão do servidor. Avise o responsável pelo aplicativo.' if missing else exc.detail
        if exc.status_code >= 500:
            detail = 'Não foi possível processar a solicitação. Tente novamente em instantes.'
        return response(request, exc.status_code, detail, 'route_not_found' if missing else 'request_failed', exc.headers)

    @app.exception_handler(RequestValidationError)
    async def invalid_data(request, exc):
        return response(request, 422, 'Dados inválidos. Confira os campos informados.', 'validation_error')

    @app.middleware('http')
    async def trace_request(request, call_next):
        request.state.request_id = uuid4().hex
        try:
            result = await call_next(request)
        except Exception as exc:
            # Mensagens de exceção SQL podem conter parâmetros pessoais; registrar só tipo e quadros.
            frames = '; '.join(f'{f.filename}:{f.lineno}:{f.name}' for f in traceback.extract_tb(exc.__traceback__))
            logger.error('request_id=%s exception=%s frames=%s', request.state.request_id, type(exc).__name__, frames)
            result = response(request, 500, 'Não foi possível processar a solicitação. Tente novamente em instantes.', 'internal_error')
        result.headers['X-Request-ID'] = request.state.request_id
        if result.status_code >= 400:
            route = getattr(request.scope.get('route'), 'path', '<unmatched>')
            logger.warning('request_id=%s method=%s route=%s status=%s', request.state.request_id, request.method, route, result.status_code)
        return result
