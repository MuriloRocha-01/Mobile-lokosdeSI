import unittest
import hashlib
import time
import test_planning as fixture
from app.database import SessionLocal
from app.models import LoginSession, User
from app import auth
from unittest.mock import patch
client = fixture.client
class SessionTests(unittest.TestCase):
    def test_persistent_session(self):
        r=client.post('/auth/register',json={'name':'Session','email':'session@example.test','password':'Test-only-123'})
        self.assertEqual(r.status_code,201,r.text)
        body=r.json(); payload={'refresh_token':body['refresh_token']}
        digest=hashlib.sha256(body['refresh_token'].encode()).hexdigest()
        with SessionLocal() as db:
            row=db.get(LoginSession,digest)
            self.assertIsNotNone(row)
            row.expires_at=int(time.time())+50; db.commit()
        with patch('app.auth.JWT_EXPIRE_MINUTES',-1):
            expired,_=auth.create_access_token(body['user']['id'])
        self.assertEqual(client.get('/auth/me',headers={'Authorization':'Bearer '+expired}).status_code,401)
        renewed=client.post('/auth/refresh',json=payload)
        self.assertEqual(renewed.status_code,200,renewed.text)
        self.assertEqual(client.get('/auth/me',headers={'Authorization':'Bearer '+renewed.json()['access_token']}).status_code,200)
        with SessionLocal() as db: self.assertGreater(db.get(LoginSession,digest).expires_at,int(time.time())+86400)
        self.assertEqual(client.get('/auth/me',headers={'Authorization':'Bearer '+body['refresh_token']}).status_code,401)
        self.assertEqual(client.post('/auth/refresh',json={'refresh_token':'x'*64}).status_code,401)
        self.assertEqual(client.post('/auth/logout',json=payload).status_code,204)
        self.assertEqual(client.post('/auth/refresh',json=payload).status_code,401)
        headers={'Authorization':'Bearer '+body['access_token']}
        migrated=client.post('/auth/session',headers=headers).json()
        with SessionLocal() as db:
            row=db.get(LoginSession,hashlib.sha256(migrated['refresh_token'].encode()).hexdigest()); row.expires_at=0; db.commit()
        self.assertEqual(client.post('/auth/refresh',json={'refresh_token':migrated['refresh_token']}).status_code,401)
        another=client.post('/auth/session',headers=headers).json()
        with SessionLocal() as db:
            user=db.get(User,body['user']['id']); user.password_hash=auth.hash_password('Changed-12345'); db.commit()
        self.assertEqual(client.post('/auth/refresh',json={'refresh_token':another['refresh_token']}).status_code,401)
if __name__=='__main__':
    try: unittest.main()
    finally: fixture.engine.dispose()
