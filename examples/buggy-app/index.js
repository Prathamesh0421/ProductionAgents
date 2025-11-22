import express from 'express';

const app = express();
const port = 8080;

app.get('/', (req, res) => {
  res.send('Hello! This is the Buggy App. Try /users/1');
});

// BUG: This route crashes when accessing a property of undefined
app.get('/users/:id', (req, res) => {
  const userId = req.params.id;
  
  // Simulate database lookup that returns null for ID 99
  let user;
  if (userId === '99') {
    user = null;
  } else {
    user = { id: userId, name: 'Test User' };
  }

  // CRASH HERE: accessing .name on null
  // Expected Fix: if (!user) return res.status(404).send('User not found');
  res.send(`User: ${user.name}`);
});

app.listen(port, () => {
  console.log(`Buggy app listening on port ${port}`);
});
