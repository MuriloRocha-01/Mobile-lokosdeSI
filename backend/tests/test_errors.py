import unittest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel
from app.errors import install_error_handling

class Input(BaseModel):
    amount: int

class ErrorTests(unittest.TestCase):
    def test_public_errors_and_safe_logs(self):
        app = FastAPI()
        install_error_handling(app)
        @app.get('/broken')
        def broken():
            raise RuntimeError('secret-password')
        @app.post('/validate')
        def validate(payload: Input):
            return payload
        @app.get('/private')
        def private():
            raise HTTPException(401, 'Entre novamente', headers={'WWW-Authenticate':'Bearer'})
        client = TestClient(app)
        with self.assertLogs('uvicorn.error') as captured:
            missing = client.get('/unknown?token=secret-token')
            bad = client.post('/validate', json={'amount':'secret-input'})
            fail = client.get('/broken')
            private = client.get('/private')
        self.assertEqual(missing.json()['code'],'route_not_found')
        self.assertEqual(bad.status_code,422)
        self.assertEqual(fail.status_code,500)
        self.assertEqual(private.headers['WWW-Authenticate'],'Bearer')
        for response in (missing,bad,fail,private):
            self.assertEqual(response.json()['request_id'],response.headers['X-Request-ID'])
        logs = '\n'.join(captured.output)
        for secret in ('secret-password','secret-token','secret-input'):
            self.assertNotIn(secret, logs)
            self.assertNotIn(secret, fail.text + bad.text)

if __name__ == '__main__':
    unittest.main()
