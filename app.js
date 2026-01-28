var express = require('express'); 
var app = express(); 
var session = require('express-session');
var conn = require('./dbConfig');
app.set('view engine','ejs');
app.use(session({
  secret: 'yoursecret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));
const multer = require('multer');
const path = require('path');

// search
app.get('/search-plantsitter', (req, res) => {
  const location = req.query.location;

  const sql = `
    SELECT *
    FROM sitter_profile
    WHERE LOWER(city) LIKE LOWER(?)
  `;

  conn.query(sql, [`%${location}%`], (err, results) => {
    if (err) {
      console.error(err);
      return res.render('search-plantsitter', {
        location,
        sitters: [],
        error: 'Database error'
      });
    }

    console.log('FOUND:', results.length);

    res.render('search-plantsitter', {
      location,
      sitters: results,
      error: null
    });
  });
});

// storage images
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

app.use('/public', express.static('public'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});
app.use('/public', express.static('public'));


// index page
app.get('/', function (req, res){ 
res.render("home"); 
}); 
//join now page
app.get('/join-now', function (req, res){ 
res.render("join-now"); 
}); 
//sign up page
app.get('/signup-owner', (req, res) => {
  res.render('signup', { role: 'owner' });
});

app.get('/signup-sitter', (req, res) => {
  res.render('signup', { role: 'sitter' });
});
app.post('/signup', function (req, res) {
  const { name, surname, email, password, role } = req.body;

  const sql = "INSERT INTO users (name, surname, email, password, role) VALUES (?, ?, ?, ?, ?)";

  conn.query(sql, [name, surname, email, password, role], (err, result) => {
    if (err) return res.send("Error registering user: " + err.message);

    // Create section
    req.session.loggedin = true;
    req.session.user = {
      user_id: result.insertId,
      name,
      surname,                
      email,
      role
    };

    // Force save before redirect
    req.session.save(err => {
      if (err) return res.send("Error saving session: " + err.message);

      console.log("SESSION AFTER SIGNUP:", req.session); //

      // Redirect according to role
      if (role.toLowerCase() === "owner") return res.redirect("/owner-dashboard");
      else return res.redirect("/sitter-dashboard");
    });
  });
});


app.get('/logout',(req, res) => { 
req.session.destroy();
res.redirect('/');
}); 
// how it works page
app.get('/how-it-works', function (req, res){ 
res.render("how-it-works"); 
}); 
//login page
app.get('/login', function (req, res){ 
res.render("login"); 
}); 

app.post('/auth', function(req, res) {

    const email = req.body.email;  
    const password = req.body.password;

    if (email && password) {

        const sql = "SELECT * FROM users WHERE email = ? AND password = ?";

        conn.query(sql, [email, password], function(err, results) {
            if (err) throw err;

            if (results.length > 0) {

                const user = results[0];

                req.session.loggedin = true;
                req.session.user = user;

                if (user.role === "owner") {
                    return res.redirect("/owner-dashboard");
                } else if (user.role === "sitter") {
                    return res.redirect("/sitter-dashboard");
                } else {
                    return res.send("User has no valid role");
                }

            } else {
                res.send('Incorrect Email and/or Password!');
            }
        });

    } else {
        res.send('Please enter Email and Password!');
    }
});

app.get('/owner-dashboard', (req, res) => {
  console.log("SESSION DASHBOARD:", req.session);
  if (!req.session.loggedin) return res.redirect('/login');
  res.render('owner/dashboard', { name: req.session.user.name });
});


app.get('/sitter-dashboard', (req, res) => {
  if (!req.session.loggedin) return res.redirect('/login');
  res.render('sitter/dashboard', { name: req.session.user.name });
});

 //owner profile 
app.get('/owner/profile', (req, res) => {
    // veify session
    if (!req.session.user) return res.redirect('/login');
    const userId = req.session.user.user_id;

    const sql = `
        SELECT u.user_id, u.name, u.email, o.full_name, o.phone, o.address, o.city, o.photo
        FROM users u
        LEFT JOIN owner_profile o ON u.user_id = o.owner_id
        WHERE u.user_id = ?
    `;

    conn.query(sql, [userId], (err, rows) => {
        if (err) return res.status(500).send("Error loading profile");

        const profile = rows[0] || {}; 
        res.render('owner/profile', { profile });
    });
});
app.post('/owner/profile', upload.single('photo'), (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const user = req.session.user;
    const userId = user.user_id;
    const full_name = user.name + ' ' + (user.surname || '');

    const phone = req.body.phone || null;
    const address = req.body.address || null;
    const city = req.body.city || null;

    let photo = null;
    if (req.file) {
        photo = '/public/uploads/' + req.file.filename;
    }

    // check the profile is existing
    const sqlCheck = `SELECT * FROM owner_profile WHERE owner_id = ?`;

    conn.query(sqlCheck, [userId], (err, result) => {
        if (err) return res.status(500).send("Error en DB");

        if (result.length > 0) {
            // UPDATE
            let updateSql = `
                UPDATE owner_profile
                SET full_name=?, phone=?, address=?, city=?, updated_at=NOW()
            `;
            const params = [full_name, phone, address, city];

            if (photo) {
                updateSql += `, photo=?`;
                params.push(photo);
            }

            updateSql += ` WHERE owner_id=?`;
            params.push(userId);

            conn.query(updateSql, params, (err) => {
                if (err) return res.status(500).send("Error updating profile");
                return res.redirect('/owner/profile');
            });
        } else {
            // INSERT
            const insertSql = `
                INSERT INTO owner_profile
                (owner_id, full_name, phone, address, city, photo, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;
            conn.query(insertSql, [userId, full_name, phone, address, city, photo], (err) => {
                if (err) return res.status(500).send("Error saving profile");
                return res.redirect('/owner/profile');
            });
        }
    });
});

//sitter profile
app.get('/sitter/profile', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const userId = req.session.user.user_id;

  const sql = `
    SELECT *
    FROM sitter_profile
    WHERE sitter_id = ?
  `;

  conn.query(sql, [userId], (err, rows) => {
    if (err) return res.status(500).send("Error loading profile");

    const profile = rows[0] || {};
    res.render('sitter/profile', { profile });
  });
});
app.post('/sitter/profile', upload.single('photo'), (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const user = req.session.user;
  const sitterId = user.user_id;
  const full_name = (user.name || '') + ' ' + (user.surname || '');

  const {
    phone,
    biography,
    skills,
    city,
    availability
  } = req.body;

  let photo = null;
  if (req.file) {
    photo = '/public/uploads/' + req.file.filename;
  }

  const sqlCheck = `SELECT * FROM sitter_profile WHERE sitter_id = ?`;

  conn.query(sqlCheck, [sitterId], (err, result) => {
    if (err) return res.status(500).send("Error in DB");

    if (result.length > 0) {
      // UPDATE
      let updateSql = `
        UPDATE sitter_profile
        SET full_name=?, phone=?, biography=?, skills=?, city=?, availability=?, updated_at=NOW()
      `;
      const params = [full_name, phone, biography, skills, city, availability];

      if (photo) {
        updateSql += `, photo=?`;
        params.push(photo);
      }

      updateSql += ` WHERE sitter_id=?`;
      params.push(sitterId);

      conn.query(updateSql, params, err => {
        if (err) return res.status(500).send("Error updating profile");
        res.redirect('/sitter/profile');
      });

    } else {
      // INSERT
      const insertSql = `
        INSERT INTO sitter_profile
        (sitter_id, full_name, phone, biography, skills, city, availability, photo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      conn.query(
        insertSql,
        [sitterId, full_name, phone, biography, skills, city, availability, photo],
        err => {
          if (err) return res.status(500).send("Error saving profile");
          res.redirect('/sitter/profile');
        }
      );
    }
  });
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  if (req.session.user.role === 'owner') {
    return res.redirect('/owner-dashboard');
  }

  if (req.session.user.role === 'sitter') {
    return res.redirect('/sitter-dashboard');
  }

  res.redirect('/');
});


// help
app.get('/help', function (req, res){ 
res.render("help"); 
}); 

// work in progress
app.get('/owner/messages', (req, res) => {
  res.render('work-in-progress');
});

app.get('/owner/my-request', (req, res) => {
  res.render('work-in-progress');
});

app.get('/sitter/my-jobs', (req, res) => {
  res.render('work-in-progress');
});

app.get('/sitter/messages', (req, res) => {
  res.render('work-in-progress');
});

app.listen(3000); 
console.log('Node app is running on port 3000');

app.use((req, res) => {
  res.status(404).render('work-in-progress');
});


