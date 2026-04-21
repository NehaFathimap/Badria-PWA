app_name        = "badria_pwa"
app_title       = "Badria PWA"
app_publisher   = "Enfono"
app_description = "Badria Van Sales PWA – Full field sales operations for ERPNext"
app_email       = "nah@enfono.com"
app_license     = "mit"

# required_apps = ["erpnext"]  # Uncomment if ERPNext is installed

website_redirects = [
    {"source": "/badria_pwa",       "target": "/assets/badria_pwa/pwa/index.html"},
    {"source": "/badria_pwa/login", "target": "/assets/badria_pwa/pwa/index.html"},
]

after_install   = "badria_pwa.install.setup.after_install"
after_uninstall = "badria_pwa.install.setup.after_uninstall"
