/* ==========================================
   1. KONFIGURASI API & JEMBATAN KOMUNIKASI
   ========================================== */

/* GANTI DENGAN URL WEB APP DEPLOYMENT BARU ANDA */
const API_URL = "https://script.google.com/macros/s/AKfycbzAmJjD1U2nJGAOd7Uqyt1uGyclAtJZPqRXjYIYE9gPCPCeFHSCbXzEFRZBDYf2YF8npA/exec"; 

/**
 * Fungsi utama untuk memanggil Backend GAS.
 * Menggunakan metode POST dengan Content-Type text/plain untuk menghindari error CORS Preflight.
 */
async function callAPI(actionName, payloadData) {
  /* Fallback jika payloadData tidak dikirim */
  payloadData = payloadData || {};
  const userToken = localStorage.getItem('sis_token') || '';
  
  const requestBody = {
    action: actionName,
    token: userToken,
    payload: payloadData
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();

    if (result.status === 'error') {
      /* Auto-Reload jika Sesi Habis/Ilegal */
      if (result.message.includes('Sesi tidak ditemukan') || result.message.includes('Sesi Berakhir') || result.message.includes('Akses Ilegal')) {
        localStorage.removeItem('sis_token');
        localStorage.removeItem('sis_expiry');
        localStorage.removeItem('sis_role');
        
        Swal.fire({
          icon: 'warning',
          title: 'Sesi Berakhir',
          text: 'Sesi Anda telah habis atau tidak valid. Memuat ulang sistem...',
          timer: 2500,
          showConfirmButton: false
        }).then(function() {
          window.location.reload(); /* Paksa muat ulang halaman */
        });
        
        throw new Error('SESSION_EXPIRED'); /* Hentikan proses lain */
      }
      
      throw new Error(result.message);
    }

    return result.data;

  } catch (error) {
    if (error.message !== 'SESSION_EXPIRED') {
      console.error("API Error [" + actionName + "]: ", error);
    }
    throw error; 
  }
}

let html5QrcodeScanner = null;
let isScanning = false;
let dataTableSiswaInstance = null;
let dataTableGuruInstance = null;

/* ==========================================
   2. STATE & DOM CONFIGURATION
   ========================================== */
const UI = {
  loader: document.getElementById('app-loader'),
  login: document.getElementById('login-screen'),
  app: document.getElementById('main-app'),
  form: document.getElementById('form-login'),
  btnSubmit: document.getElementById('btn-login'),
  displayRole: document.getElementById('display-role'),
  contentView: document.getElementById('content-view')
};

/* Daftarkan listener ke DOM lifecycle */
document.addEventListener("DOMContentLoaded", () => {
  checkAuthStatus();
  initFormTambahSiswa();
  initFormEditSiswa();
  initFormTambahGuru();
  initFormEditGuru();
  setupWaliKelasToggle();
});

/* Fungsi Toggle Lihat Password di Form Login */
function togglePassword() {
  const passInput = document.getElementById('password');
  const iconEye = document.getElementById('icon-eye');
  
  if (passInput.type === 'password') {
    passInput.type = 'text';
    iconEye.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    passInput.type = 'password';
    iconEye.classList.replace('fa-eye-slash', 'fa-eye');
  }
}

/* ==========================================
   3. ROUTING CONTROLLER & ROUTER SWITCH
   ========================================== */
function checkAuthStatus() {
  const token = localStorage.getItem('sis_token');
  const expiry = localStorage.getItem('sis_expiry');
  const now = Date.now();

  if (!token || !expiry || now > Number(expiry)) {
    clearSession();
    showView('login');
  } else {
    const role = localStorage.getItem('sis_role');
	const namaUser = localStorage.getItem('sis_nama_user') || 'Pengguna';
	
    UI.displayRole.innerText = role;
	
	const elSidebarNama = document.getElementById('sidebar-nama-user');
    if (elSidebarNama) elSidebarNama.innerText = namaUser;
    
    /* Tampilkan menu pengaturan khusus Admin */
    const menuPengaturan = document.getElementById('menu-pengaturan');
    const menuUser = document.getElementById('menu-manajemen-user');
    const menuKenaikan = document.getElementById('menu-kenaikan-kelas');
    if (role === 'Admin') {
      if (menuPengaturan) menuPengaturan.style.display = 'flex';
      if (menuUser) menuUser.style.display = 'flex';
      if (menuKenaikan) menuKenaikan.style.display = 'flex';
    }
    else{
      if (menuPengaturan) menuPengaturan.style.display = 'none';
      if (menuUser) menuUser.style.display = 'none';
      if (menuKenaikan) menuKenaikan.style.display = 'none';
    }
    
    showView('app');
    renderBeranda();
    
    applyRBAC();
	
	if (localStorage.getItem('sis_force_pass') === 'true') {
      /* Cegah modal ditutup dengan klik di luar atau tombol ESC */
      const modalEl = document.getElementById('modalUbahPassword');
      const modalObj = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });
      
      /* Sembunyikan tombol Batal dan Close agar user tidak bisa kabur 
      modalEl.querySelector('.btn-close').style.display = 'none';
      modalEl.querySelector('[data-bs-dismiss="modal"]').style.display = 'none';*/
      
      /* Ubah pesan info */
      modalEl.querySelector('.alert-info').innerHTML = '<i class="fa-solid fa-triangle-exclamation me-1"></i> Anda menggunakan password default. Demi keamanan, Anda <strong>WAJIB</strong> mengubah password sekarang.';
      modalEl.querySelector('.alert-info').classList.replace('alert-info', 'alert-danger');
      
      modalObj.show();
    }
  }
}

/* Fungsi Data-Driven UI untuk mengatur tampilan menu berdasarkan instruksi Backend */
async function applyRBAC() {
  try {
    /* Minta instruksi status semua menu dari backend */
    const menuStatusArray = await callAPI('getAllowedMenus');
    
    let isMasterDataAllowed = false;
    let isAkademikAllowed = false;

    for (let i = 0; i < menuStatusArray.length; i++) {
      let modul = menuStatusArray[i];
      
      /* Format ID HTML: MOD_01 menjadi menu-mod-01 */
      let menuId = 'menu-' + modul.id_modul.toLowerCase().replace('_', '-');
      let el = document.getElementById(menuId);
      
      if (el) {
        if (modul.is_allowed) {
          el.style.display = ''; /* Tampilkan menu */
          
          /* Deteksi apakah Parent Menu perlu ditampilkan */
          if (modul.id_modul === 'MOD_01' || modul.id_modul === 'MOD_02') {
            isMasterDataAllowed = true;
          }
          if (modul.id_modul === 'MOD_05' || modul.id_modul === 'MOD_06') {
            isAkademikAllowed = true;
          }
          
        } else {
          el.style.setProperty("display", "none", "important"); /* Sembunyikan menu */
        }
      }
    }
    
    /* Logika Parent Menu: Master Data */
    const menuMasterData = document.getElementById('menu-master-data');
    if (menuMasterData) {
      if (isMasterDataAllowed) {
        menuMasterData.style.display = '';
      } else {
        menuMasterData.style.setProperty("display", "none", "important");
      }
    }
    
    /* Logika Parent Menu: Akademik (Jika Anda memiliki ID parent untuk Akademik) */
    /* Catatan: Di HTML Anda saat ini, parent Akademik tidak memiliki ID khusus, 
       tapi jika nanti Anda menambahkannya (misal: id="menu-akademik"), 
       Anda bisa menggunakan variabel isAkademikAllowed di sini. */
       
  } catch (err) {
    console.error('Gagal memuat hak akses menu: ', err);
  }
}

function showView(viewName) {
  UI.loader.classList.add('d-none');
  UI.login.classList.add('d-none');
  UI.app.classList.add('d-none');

  if (viewName === 'login') {
    UI.login.classList.remove('d-none');
  } else if (viewName === 'app') {
    UI.app.classList.remove('d-none');
  }
}

function switchMenu(menuName, element) {
  if(!element) return;

  /* Matikan kamera jika sedang menyala dan user pindah menu */
  stopScanner();

  document.querySelectorAll('.nav-link').forEach(function(link) {
    if(!link.hasAttribute('data-bs-toggle')) {
      link.classList.remove('active');
    }
  });

  element.classList.add('active');

  if(menuName === 'dashboard') {
    renderBeranda();
  } else if (menuName === 'master-siswa') {
    renderMasterSiswa();
  } else if (menuName === 'pengaturan-sistem') {
    renderPengaturanSistem();
  } else if (menuName === 'presensi-umum') {
    renderPresensiUmum();
  } else if (menuName === 'master-guru') {
    renderMasterGuru();
  } else if (menuName === 'jurnal-mengajar') {
    renderJurnalMengajar();
  } else if (menuName === 'intervensi-wali') {
    renderIntervensiWali();
  } else if (menuName === 'manajemen-user') {
    renderManajemenUser();
  } else if (menuName === 'laporan') {
    renderLaporanAkademik();
  } else if (menuName === 'manajemen-database') {
    renderManajemenDatabase();
  } else {
    UI.contentView.innerHTML = '<div class="alert alert-warning fade-in"><i class="fa-solid fa-triangle-exclamation me-2"></i>Menu Fitur <strong>' + menuName + '</strong> sedang disiapkan.</div>';
  }

  if(window.innerWidth <= 768) {
    toggleSidebar();
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if(sidebar) {
    sidebar.classList.toggle('active');
  }
}

/* ==========================================
   4. RENDER DASHBOARD (DENGAN GRAFIK)
   ========================================== */

let chartPresensiInstance = null;

function renderBeranda() {
  UI.contentView.innerHTML = '<div class="fade-in">' +
    '<h3 class="fw-bold mb-1">Beranda Dashboard</h3>' +
    '<p class="text-secondary mb-4">Ringkasan aktivitas operasional sekolah hari ini.</p>' +
    '<div class="row g-3 mb-4">' +
      '<div class="col-md-3 col-6">' +
        '<div class="card stat-card shadow-sm border-0 border-start border-primary border-4">' +
          '<div class="card-body">' +
            '<h6 class="text-muted mb-1 small fw-bold">Total Siswa</h6>' +
            '<h3 class="fw-bold mb-0 text-primary" id="stat-total"><span class="spinner-border spinner-border-sm"></span></h3>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="col-md-3 col-6">' +
        '<div class="card stat-card shadow-sm border-0 border-start border-success border-4">' +
          '<div class="card-body">' +
            '<h6 class="text-muted mb-1 small fw-bold">Hadir Tepat Waktu</h6>' +
            '<h3 class="fw-bold mb-0 text-success" id="stat-hadir"><span class="spinner-border spinner-border-sm"></span></h3>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="col-md-3 col-6">' +
        '<div class="card stat-card shadow-sm border-0 border-start border-warning border-4">' +
          '<div class="card-body">' +
            '<h6 class="text-muted mb-1 small fw-bold">Siswa Terlambat</h6>' +
            '<h3 class="fw-bold mb-0 text-warning" id="stat-terlambat"><span class="spinner-border spinner-border-sm"></span></h3>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="col-md-3 col-6">' +
        '<div class="card stat-card shadow-sm border-0 border-start border-danger border-4">' +
          '<div class="card-body">' +
            '<h6 class="text-muted mb-1 small fw-bold">Tidak Hadir (S/I/A)</h6>' +
            '<h3 class="fw-bold mb-0 text-danger" id="stat-absen"><span class="spinner-border spinner-border-sm"></span></h3>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="row g-4">' +
      '<div class="col-md-8">' +
        '<div class="card shadow-sm border-0" style="border-radius: 15px;">' +
          '<div class="card-header bg-white fw-bold py-3 border-0">' +
            '<i class="fa-solid fa-chart-pie text-primary me-2"></i>Persentase Kehadiran Hari Ini' +
          '</div>' +
          '<div class="card-body d-flex justify-content-center align-items-center" style="min-height: 300px;">' +
            '<div style="width: 100%; max-width: 350px; position: relative;">' +
              '<canvas id="grafikPresensi"></canvas>' +
              '<div id="chart-center-text" class="position-absolute top-50 start-50 translate-middle text-center d-none">' +
                '<h4 class="fw-bold mb-0 text-success" id="persen-hadir">0%</h4>' +
                '<small class="text-muted" style="font-size: 10px;">Kehadiran</small>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="col-md-4">' +
        '<div class="card shadow-sm border-0 bg-white mb-4" style="border-radius: 15px;">' +
          '<div class="card-body p-4">' +
            '<h6 class="fw-bold mb-3 border-bottom pb-2">Rincian Tidak Hadir</h6>' +
            '<div class="d-flex justify-content-between mb-2 small">' +
              '<span class="text-warning fw-bold"><i class="fa-solid fa-bed me-2"></i>Sakit</span>' +
              '<strong id="det-sakit">0</strong>' +
            '</div>' +
            '<div class="d-flex justify-content-between mb-2 small">' +
              '<span class="text-info fw-bold"><i class="fa-solid fa-envelope me-2"></i>Izin</span>' +
              '<strong id="det-izin">0</strong>' +
            '</div>' +
            '<div class="d-flex justify-content-between small">' +
              '<span class="text-danger fw-bold"><i class="fa-solid fa-triangle-exclamation me-2"></i>Alpa</span>' +
              '<strong id="det-alpa">0</strong>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card shadow-sm border-0 bg-white" style="border-radius: 15px;">' +
          '<div class="card-header bg-white fw-bold py-3 border-0">' +
            '<i class="fa-solid fa-circle-info text-info me-2"></i>Informasi Sistem' +
          '</div>' +
          '<div class="card-body px-4 pb-4">' +
            '<ul class="list-unstyled small text-secondary mb-0">' +
              '<li class="mb-3"><i class="fa-solid fa-calendar text-primary me-2"></i> Tahun Ajaran: <strong id="info-tahun" class="text-dark">Memuat...</strong></li>' +
              '<li class="mb-3"><i class="fa-solid fa-circle-nodes text-primary me-2"></i> Semester: <strong id="info-semester" class="text-dark">Memuat...</strong></li>' +
              '<li><i class="fa-solid fa-database text-success me-2"></i> Database Server: <strong class="text-success">Connected</strong></li>' +
              '<li id="info-email-container" class="d-none border-top pt-3 mt-2">' +
                '<i class="fa-solid fa-envelope-circle-check text-warning me-2"></i> Sisa Kuota Email: <strong id="info-kuota-email" class="text-dark">Memuat...</strong>' +
                '<div class="text-muted mt-1" style="font-size: 10px; margin-left: 22px;">*Reset otomatis setiap jam 12 malam.</div>' +
              '</li>' +
            '</ul>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
  updateStats();
}

async function updateStats() {
  try {
    const statData = await callAPI('getStatistikDashboard');
    
    const totalTidakHadir = statData.sakit + statData.izin + statData.alpa;
    document.getElementById('stat-total').innerText = statData.total_siswa;
    document.getElementById('stat-hadir').innerText = statData.hadir;
    document.getElementById('stat-terlambat').innerText = statData.terlambat;
    document.getElementById('stat-absen').innerText = totalTidakHadir;
    
    document.getElementById('info-tahun').innerText = statData.tahun_ajaran;
    document.getElementById('info-semester').innerText = statData.semester;
    document.getElementById('det-sakit').innerText = statData.sakit;
    document.getElementById('det-izin').innerText = statData.izin;
    document.getElementById('det-alpa').innerText = statData.alpa;
    
    if (statData.role === 'Admin') {
      document.getElementById('info-email-container').classList.remove('d-none');
      const elKuota = document.getElementById('info-kuota-email');
      elKuota.innerText = statData.kuota_email + " Pesan";
      if (statData.kuota_email < 10) elKuota.classList.replace('text-dark', 'text-danger');
    }

    /* RENDER GRAFIK DINAMIS */
    renderGrafik(statData);

    /* TRIGGER MODAL EWS JIKA ADA DATA */
    if (statData.ews_alerts && statData.ews_alerts.length > 0) {
      tampilkanModalEWS(statData.ews_alerts);
    }

  } catch (err) {
    console.error('Gagal memuat statistik: ', err);
  }
}

function renderGrafik(data) {
  const ctx = document.getElementById('grafikPresensi');
  if (!ctx) return;
  if (chartPresensiInstance) chartPresensiInstance.destroy();

  /* JIKA ADMIN/KEPSEK: Tampilkan Bar Chart Per Kelas */
  if (data.role === 'Admin' || data.role === 'Kepsek') {
    document.getElementById('chart-center-text').classList.add('d-none');
    
    const labels = Object.keys(data.data_per_kelas).sort();
    const dataHadir = labels.map(k => data.data_per_kelas[k].hadir + data.data_per_kelas[k].terlambat);
    const dataAlpa = labels.map(k => data.data_per_kelas[k].alpa);
    const dataSakitIzin = labels.map(k => data.data_per_kelas[k].sakit + data.data_per_kelas[k].izin);

    chartPresensiInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Hadir', data: dataHadir, backgroundColor: '#198754' },
          { label: 'Sakit/Izin', data: dataSakitIzin, backgroundColor: '#0dcaf0' },
          { label: 'Alpa', data: dataAlpa, backgroundColor: '#dc3545' }
        ]
      },
      options: {
        responsive: true,
        scales: { x: { stacked: true }, y: { stacked: true } },
        plugins: { legend: { position: 'bottom' } }
      }
    });
  } 
  /* JIKA GURU/WALI KELAS: Tampilkan Doughnut Chart */
  else {
    const totalHadir = data.hadir + data.terlambat;
    let persenHadir = data.total_siswa > 0 ? Math.round((totalHadir / data.total_siswa) * 100) : 0;
    document.getElementById('persen-hadir').innerText = persenHadir + '%';
    document.getElementById('chart-center-text').classList.remove('d-none');

    chartPresensiInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Hadir', 'Terlambat', 'Sakit', 'Izin', 'Alpa'],
        datasets: [{
          data: [data.hadir, data.terlambat, data.sakit, data.izin, data.alpa],
          backgroundColor: ['#198754', '#ffc107', '#fd7e14', '#0dcaf0', '#dc3545']
        }]
      },
      options: { responsive: true, cutout: '75%', plugins: { legend: { position: 'bottom' } } }
    });
  }
}

/* FUNGSI MENAMPILKAN MODAL EWS */
function tampilkanModalEWS(alerts) {
  const container = document.getElementById('ews-container');
  let html = '';
  
  for(let i=0; i<alerts.length; i++) {
    let a = alerts[i];
    html += '<div class="card border-danger mb-3 shadow-sm" id="ews-card-'+a.id_siswa+'">';
    html += '<div class="card-body">';
    html += '<div class="d-flex justify-content-between align-items-center mb-3">';
    html += '<div><h6 class="fw-bold mb-0">'+a.nama_lengkap+'</h6><small class="text-muted">NISN: '+a.nisn+'</small></div>';
    html += '<span class="badge bg-danger fs-6">'+a.jumlah_alpa+' Kali Alpa</span>';
    html += '</div>';
    html += '<div class="mb-2"><label class="small fw-bold">Tindakan yang dilakukan:</label>';
    html += '<select class="form-select form-select-sm mb-2" id="ews-tindakan-'+a.id_siswa+'">';
    html += '<option value="Menghubungi Orang Tua via Telepon/WA">Menghubungi Orang Tua via Telepon/WA</option>';
    html += '<option value="Pemanggilan Orang Tua ke Sekolah">Pemanggilan Orang Tua ke Sekolah</option>';
    html += '<option value="Kunjungan Rumah (Home Visit)">Kunjungan Rumah (Home Visit)</option>';
    html += '<option value="Koordinasi dengan Guru BK">Koordinasi dengan Guru BK</option>';
    html += '</select></div>';
    html += '<button class="btn btn-danger btn-sm w-100 fw-bold" onclick="simpanEWS(\''+a.id_siswa+'\', \''+a.nisn+'\', \''+a.nama_lengkap+'\', '+a.jumlah_alpa+')"><i class="fa-solid fa-check me-1"></i> Simpan Tindakan</button>';
    html += '</div></div>';
  }
  
  container.innerHTML = html;
  new bootstrap.Modal(document.getElementById('modalEWS')).show();
}

/* FUNGSI SIMPAN EWS */
async function simpanEWS(idSiswa, nisn, nama, jmlAlpa) {
  const tindakan = document.getElementById('ews-tindakan-'+idSiswa).value;
  try {
    await callAPI('simpanTindakanEWS', { id_siswa: idSiswa, nisn: nisn, nama_siswa: nama, jumlah_alpa: jmlAlpa, tindakan: tindakan });
    document.getElementById('ews-card-'+idSiswa).remove();
    
    /* Jika semua peringatan sudah ditangani, tutup modal */
    if(document.getElementById('ews-container').children.length === 0) {
      bootstrap.Modal.getInstance(document.getElementById('modalEWS')).hide();
      updateStats(); /* Refresh dashboard */
    }
  } catch (err) {
    Swal.fire('Gagal', err.message, 'error');
  }
}

/* ==========================================
   5. RENDER TABEL SISWA DENGAN FILTER & DATATABLES
   ========================================== */
async function renderMasterSiswa() {
  UI.contentView.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted">Mengambil data dari server...</p></div>';

  try {
    const userRole = localStorage.getItem('sis_role');
    
    /* 1. Ambil daftar kelas untuk Dropdown (Hanya jika Admin/Kepsek) */
    let daftarKelas = [];
    if (userRole === 'Admin' || userRole === 'Kepsek') {
      daftarKelas = await callAPI('getDaftarKelasDistinct');
    }

    /* 2. Ambil Data Siswa Default (Status: Aktif, Kelas: SEMUA) */
    const payloadDefault = { filterStatus: "Aktif", filterKelas: "SEMUA" };
    const dataSiswa = await callAPI('getSiswaData', payloadDefault);
    window.allSiswa = dataSiswa;

    /* 3. Bangun Kerangka UI */
    let html = '<div class="d-flex justify-content-between align-items-center mb-3 fade-in">';
    html += '<h4 class="fw-bold mb-0">Master Data Siswa</h4>';
    html += '<div>';
    
    if (userRole === 'Admin') {
      html += '<button class="btn btn-primary btn-sm me-2" data-bs-toggle="modal" data-bs-target="#modalTambahSiswa"><i class="fa-solid fa-plus me-1"></i> Tambah Siswa</button>';
      html += '<button class="btn btn-success btn-sm me-2" data-bs-toggle="modal" data-bs-target="#modalImportSiswa"><i class="fa-solid fa-file-excel me-1"></i> Import</button>';
    }
    
    html += '<button class="btn btn-secondary btn-sm" onclick="bukaModalCetakMassal()"><i class="fa-solid fa-print me-1"></i> Cetak Massal</button>';
    html += '</div></div>';

    /* UI Dropdown Filter (Hanya tampil untuk Admin/Kepsek) */
    if (userRole === 'Admin' || userRole === 'Kepsek') {
      html += '<div class="row mb-3 fade-in">';
      
      html += '<div class="col-md-3 mb-2">';
      html += '<select id="filter-kelas" class="form-select border-0 shadow-sm" onchange="eksekusiFilterSiswa()">';
      html += '<option value="SEMUA">Semua Kelas</option>';
      for(let k = 0; k < daftarKelas.length; k++) {
        html += '<option value="' + daftarKelas[k] + '">' + daftarKelas[k] + '</option>';
      }
      html += '</select></div>';

      html += '<div class="col-md-3 mb-2">';
      html += '<select id="filter-status" class="form-select border-0 shadow-sm" onchange="eksekusiFilterSiswa()">';
      html += '<option value="SEMUA">Semua Status</option>';
      html += '<option value="Aktif" selected>Aktif</option>';
      html += '<option value="Lulus">Lulus</option>';
      html += '<option value="Mutasi">Mutasi</option>';
      html += '<option value="Nonaktif">Nonaktif</option>';
      html += '</select></div>';
      
      html += '</div>';
    }

    /* UI Kerangka Tabel */
    html += '<div class="card shadow-sm border-0 fade-in"><div class="card-body p-3 table-responsive">';
    html += '<table id="tabel-siswa" class="table table-hover align-middle mb-0"><thead class="table-light"><tr><th>No</th><th>NIS</th><th>Nama Lengkap</th><th>Kelas</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="tbody-siswa">';
    html += '</tbody></table></div></div>';

    UI.contentView.innerHTML = html;

    /* 4. Render Isi Tabel Pertama Kali */
    renderIsiTabelSiswa(window.allSiswa);

  } catch (error) {
    Swal.fire('Error Server', error.message, 'error');
  }
}

/* Fungsi untuk meminta data baru ke server berdasarkan dropdown */
async function eksekusiFilterSiswa() {
  const valKelas = document.getElementById('filter-kelas').value;
  const valStatus = document.getElementById('filter-status').value;

  /* Tampilkan loading di tabel */
  if (dataTableSiswaInstance) {
    dataTableSiswaInstance.destroy();
    dataTableSiswaInstance = null;
  }
  document.getElementById('tbody-siswa').innerHTML = '<tr><td colspan="6" class="text-center py-5"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Menyaring data dari server...</td></tr>';

  try {
    /* Minta data ke backend dengan parameter filter */
    const payloadFilter = { filterStatus: valStatus, filterKelas: valKelas };
    const filteredData = await callAPI('getSiswaData', payloadFilter);
    
    /* Simpan ke memori lokal untuk keperluan Edit/Cetak */
    window.allSiswa = filteredData;
    
    /* Render ulang tabel */
    renderIsiTabelSiswa(filteredData);
  } catch (error) {
    Swal.fire('Gagal Menyaring Data', error.message, 'error');
    document.getElementById('tbody-siswa').innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Gagal memuat data.</td></tr>';
  }
}

/* ==========================================
   FUNGSI HELPER: REFRESH TABEL & DROPDOWN
   ========================================== */
async function refreshDataSiswa() {
  const userRole = localStorage.getItem('sis_role');
  
  /* 1. Perbarui Dropdown Kelas (Hanya untuk Admin/Kepsek) */
  if (userRole === 'Admin' || userRole === 'Kepsek') {
    try {
      const daftarKelas = await callAPI('getDaftarKelasDistinct');
      const elFilterKelas = document.getElementById('filter-kelas');
      
      if (elFilterKelas) {
        /* Simpan nilai yang sedang dipilih Admin saat ini */
        const currentSelection = elFilterKelas.value;
        
        let opsiHtml = '<option value="SEMUA">Semua Kelas</option>';
        for(let k = 0; k < daftarKelas.length; k++) {
          opsiHtml += '<option value="' + daftarKelas[k] + '">' + daftarKelas[k] + '</option>';
        }
        elFilterKelas.innerHTML = opsiHtml;
        
        /* Kembalikan pilihan Admin (jika kelas tersebut masih ada) */
        if (daftarKelas.includes(currentSelection) || currentSelection === "SEMUA") {
          elFilterKelas.value = currentSelection;
        }
      }
    } catch (e) {
      console.error("Gagal memperbarui dropdown kelas:", e);
    }
  }
  
  /* 2. Refresh isi tabel sesuai filter yang aktif */
  eksekusiFilterSiswa();
}

/* Fungsi untuk menggambar baris tabel dan menginisialisasi DataTables */
function renderIsiTabelSiswa(dataArray) {
  /* Hancurkan instance DataTable lama jika ada agar tidak error saat di-render ulang */
  if (dataTableSiswaInstance) {
    dataTableSiswaInstance.destroy();
    dataTableSiswaInstance = null;
  }

  let tableRows = '';
  if (!dataArray || dataArray.length === 0) {
    tableRows = '<tr><td colspan="6" class="text-center text-muted py-4">Tidak ada data yang sesuai dengan filter.</td></tr>';
  } else {
    for (let i = 0; i < dataArray.length; i++) {
      let siswa = dataArray[i];
      let qrImageUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' + siswa.id_siswa;
      
      /* Pewarnaan Badge Status Dinamis */
      let badgeColor = 'bg-secondary';
      if (siswa.status_siswa === 'Aktif') badgeColor = 'bg-success';
      else if (siswa.status_siswa === 'Lulus') badgeColor = 'bg-primary';
      else if (siswa.status_siswa === 'Mutasi') badgeColor = 'bg-warning text-dark';

      tableRows += '<tr>';
      tableRows += '<td>' + (i + 1) + '</td>';
      tableRows += '<td><strong>' + siswa.nis + '</strong></td>';
      tableRows += '<td>' + siswa.nama_lengkap + '</td>';
      tableRows += '<td>' + siswa.tingkat_kelas + ' - ' + siswa.rombel_kelas + '</td>';
      tableRows += '<td><span class="badge ' + badgeColor + '">' + siswa.status_siswa + '</span></td>';
      tableRows += '<td><div class="btn-group font-monospace">';
      tableRows += '<button class="btn btn-sm btn-outline-dark" title="QR" onclick="window.open(\'' + qrImageUrl + '\', \'_blank\')"><i class="fa-solid fa-qrcode"></i></button>';
      tableRows += '<button class="btn btn-sm btn-warning text-dark" title="Edit" onclick="bukaModalEditSiswa(\'' + siswa.id_siswa + '\')"><i class="fa-solid fa-pen-to-square"></i></button>';
      tableRows += '<button class="btn btn-sm btn-primary" title="Cetak" onclick="eksekusiCetakKartu(\'' + siswa.id_siswa + '\')"><i class="fa-solid fa-print"></i></button>';
      tableRows += '</div></td></tr>';
    }
  }

  document.getElementById('tbody-siswa').innerHTML = tableRows;

  /* Inisialisasi ulang DataTable jika ada data */
  if (dataArray && dataArray.length > 0) {
    const tableElement = document.getElementById('tabel-siswa');
    dataTableSiswaInstance = new simpleDatatables.DataTable(tableElement, {
      searchable: true,
      fixedHeight: false,
      perPage: 10,
	  columns: [
		{
			select: 0, 
			sortable: false,
			searchable: false,
			render: function (data, td, rowIndex, cellIndex) {
                return (rowIndex + 1).toString();
            }
		},
		{ select: 2, sort: "asc" },
		{ select: 4, sortable: false, searchable: false },
		{ select: 5, sortable: false, searchable: false }
	  ],
      labels: {
        placeholder: "Cari NIS atau Nama...",
        perPage: "data per halaman",
        noRows: "Tidak ada data ditemukan",
        info: "Menampilkan {start} sampai {end} dari {rows} data"
      }
    });
  }
}

/* ==========================================
   6. CRUD CONTROLLER LOGIC (CREATE + UPDATE SISWA)
   ========================================== */

/* Fungsi untuk mengunduh template Excel kosong */
function downloadTemplateExcel() {
  /* 1. Buat array data dengan 3 Baris: Header, Petunjuk, dan Data Dummy */
  const templateData = [
    ["NIS", "NISN", "Nama Lengkap", "NIK", "Jenis Kelamin (L/P)", "Tempat Lahir", "Tanggal Lahir (YYYY-MM-DD)", "Alamat Lengkap", "Gol Darah", "Tingkat Kelas (7/8/9)", "Rombel Kelas", "Nama Wali", "No HP Wali", "Email Wali"],
    ["(WAJIB) Unik", "Format Teks", "(WAJIB) Sesuai Ijazah", "Sesuai KK", "(WAJIB) L atau P", "(Opsional)", "(Opsional) YYYY-MM-DD", "(Opsional)", "(Opsional) -/A/B/AB/O", "(WAJIB) 7/8/9", "(WAJIB) Cth: PPLG 1", "(Opsional)", "(Opsional) Format Teks", "(Opsional)"],
    ["2425001", "0056123456", "Budi Santoso", "1234567890123456", "L", "Jakarta", "2010-05-15", "Jl. Merdeka No. 1", "O", "X", "PPLG 1", "Bapak Budi", "081234567890", "budi@email.com"]
  ];

  const ws = XLSX.utils.aoa_to_sheet(templateData);

  /* 2. PROTEKSI FORMAT TEKS (Mencegah Nol Hilang & Format Berubah) */
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    let cellA = ws[XLSX.utils.encode_cell({c: 0, r: R})]; if (cellA) cellA.z = '@'; 
    let cellB = ws[XLSX.utils.encode_cell({c: 1, r: R})]; if (cellB) cellB.z = '@';
	let cellD = ws[XLSX.utils.encode_cell({c: 3, r: R})]; if (cellD) cellD.z = '@';
    let cellF = ws[XLSX.utils.encode_cell({c: 6, r: R})]; if (cellF) cellF.z = '@';
    let cellJ = ws[XLSX.utils.encode_cell({c: 10, r: R})]; if (cellJ) cellJ.z = '@';
    let cellL = ws[XLSX.utils.encode_cell({c: 12, r: R})]; if (cellL) cellL.z = '@';
  }

  /* 3. ATUR LEBAR KOLOM AGAR RAPI SAAT DIBUKA */
  ws['!cols'] = [
    { wch: 15 }, /* A: NIS */
    { wch: 20 }, /* B: NISN */
    { wch: 25 }, /* C: Nama Lengkap */
	{ wch: 25 }, /* D: NIK */
    { wch: 18 }, /* E: Jenis Kelamin */
    { wch: 15 }, /* F: Tempat Lahir */
    { wch: 25 }, /* G: Tanggal Lahir */
    { wch: 30 }, /* H: Alamat Lengkap */
    { wch: 20 }, /* I: Gol Darah */
    { wch: 20 }, /* J: Tingkat Kelas */
    { wch: 20 }, /* K: Rombel Kelas */
    { wch: 20 }, /* L: Nama Wali */
    { wch: 20 }, /* M: No HP Wali */
    { wch: 25 }  /* N: Email Wali */
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template_Siswa");
  XLSX.writeFile(wb, "Template_Import_Siswa.xlsx");
}

/* Event Listener Form Import (Dipanggil 1x saat DOM Load) */
document.addEventListener("DOMContentLoaded", function() {
  const formImport = document.getElementById('form-import-siswa');
  if (formImport) {
    formImport.addEventListener('submit', function(e) {
      e.preventDefault();
      
      const fileInput = document.getElementById('file-excel-siswa');
      const file = fileInput.files[0];
      if (!file) return;

      const btn = document.getElementById('btn-proses-import');
      const oriText = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Membaca File...';

      /* Gunakan FileReader untuk membaca file Excel */
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          
          /* Ambil sheet pertama */
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          /* Konversi sheet ke format JSON (Array of Arrays) */
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          if (jsonData.length <= 2) throw new Error("File Excel kosong atau hanya berisi header.");

          btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Mengirim ke Server...';

          /* Mapping data Excel ke format Payload Backend */
          let payloadSiswa = [];
          for (let i = 2; i < jsonData.length; i++) {
            let row = jsonData[i];
            
            let tglLahir = row[6] || "";
            if (typeof tglLahir === 'number') {
              let dateObj = new Date(Math.round((tglLahir - 25569) * 86400 * 1000));
              tglLahir = dateObj.toISOString().split('T')[0];
            }

            payloadSiswa.push({
              baris_excel: i + 1,
			  nis: (row[0] || "").toString(),
              nisn: (row[1] || "").toString(),
              nama_lengkap: row[2] || "",
			  NIK: row[3] || "",
              jenis_kelamin: row[4] || "L",
              tempat_lahir: row[5] || "",
              tanggal_lahir: tglLahir,
              alamat_lengkap: row[7] || "",
              gol_darah: row[8] || "-",
              tingkat_kelas: (row[9] || "").toString(),
              rombel_kelas: (row[10] || "").toString(),
              nama_wali_murid: row[11] || "",
              no_hp_wali: (row[12] || "").toString(),
              email_wali: row[13] || ""
            });
          }

          if (payloadSiswa.length === 0) throw new Error("Tidak ada data valid yang bisa diimpor.");

          /* Kirim ke Backend API */
          const res = await callAPI('importSiswaMassal', { dataSiswa: payloadSiswa });
		  
		  if (res.error_log && res.error_log.length > 0) {
            /* Jika ada data yang gagal, buat tabel HTML untuk log error */
            let errorHtml = '<div class="text-start mt-3"><p class="text-danger fw-bold mb-2"><i class="fa-solid fa-triangle-exclamation me-2"></i>Daftar Data Gagal:</p>';
            errorHtml += '<div class="table-responsive" style="max-height: 200px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: 8px;">';
            errorHtml += '<table class="table table-sm table-hover mb-0" style="font-size: 0.85rem;">';
            errorHtml += '<thead class="table-light" style="position: sticky; top: 0;"><tr><th>Detail Kesalahan</th></tr></thead><tbody>';
            
            for (let i = 0; i < res.error_log.length; i++) {
              errorHtml += '<tr><td class="text-danger">' + res.error_log[i] + '</td></tr>';
            }
            
            errorHtml += '</tbody></table></div></div>';
            errorHtml += '<p class="text-muted small mt-2 mb-0">Data yang valid tetap berhasil disimpan. Silakan perbaiki data yang gagal di atas dan import ulang khusus untuk data tersebut.</p>';

            Swal.fire({ 
              icon: 'warning', 
              title: 'Import Selesai Sebagian', 
              html: '<strong>' + res.message + '</strong>' + errorHtml,
              width: '600px', /* Lebarkan modal agar tabel terbaca jelas */
              confirmButtonText: 'Tutup & Perbaiki'
            });
          } else {
            /* Jika 100% berhasil tanpa error */
            Swal.fire({ icon: 'success', title: 'Import Sukses', text: res.message });
          }
          
          bootstrap.Modal.getInstance(document.getElementById('modalImportSiswa')).hide();
          formImport.reset();
		  
		  refreshDataSiswa();

        } catch (err) {
          Swal.fire('Gagal', err.message, 'error');
        } finally {
          btn.disabled = false; btn.innerHTML = oriText;
        }
      };
      
      reader.readAsArrayBuffer(file);
    });
  }
});

function initFormTambahSiswa() {
  const formTambah = document.getElementById('form-tambah-siswa');
  if(!formTambah) return;

  formTambah.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSimpan = document.getElementById('btn-simpan-siswa');
    const originalText = btnSimpan.innerHTML;
    
    /* Mencegah klik ganda (UI Anti-Bentrok) */
    btnSimpan.disabled = true;
    btnSimpan.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Memproses Berkas...';
    
    try {
      /* Pemrosesan File Gambar ke Base64 secara Asynchronous */
      const fileInput = document.getElementById('p-foto');
      let fotoObj = null;
      
      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        /* Validasi ukuran berkas di client-side (Maksimal 2MB agar GAS tidak overload) */
        if (file.size > 2 * 1024 * 1024) {
          throw new Error("Ukuran foto terlalu besar. Maksimal resolusi berukuran 2MB.");
        }
        
        const reader = new FileReader();
        reader.readAsDataURL(file);
        await new Promise(resolve => reader.onload = resolve);
        
        const stringBase64 = reader.result.split(',');
        fotoObj = {
          mimeType: stringBase64[0].match(/:(.*?);/)[1],
          base64: stringBase64[1]
        };
      }

      btnSimpan.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Menyimpan ke Server...';

      /* Pembangunan Objek Payload Siswa Lengkap */
      const payloadSiswa = {
        nis: document.getElementById('p-nis').value,
		nisn: document.getElementById('p-nisn').value,
        nama_lengkap: document.getElementById('p-nama').value,
		nik: document.getElementById('p-nik').value,
		jenis_kelamin: document.getElementById('p-jk').value,
        tingkat_kelas: document.getElementById('p-tingkat').value,
        rombel_kelas: document.getElementById('p-rombel').value,
        tempat_lahir: document.getElementById('p-tempat-lahir').value,
        tanggal_lahir: document.getElementById('p-tanggal-lahir').value,
        gol_darah: document.getElementById('p-goldarah').value,
        alamat_lengkap: document.getElementById('p-alamat').value,
        nama_wali_murid: document.getElementById('p-wali').value,
        no_hp_wali: document.getElementById('p-hp-wali').value,
        email_wali: document.getElementById('p-email-wali').value,
        telegram_chat_id: document.getElementById('p-tele-wali').value,
        foto_upload: fotoObj 
      };

      /* Pengiriman Data Terproteksi ke Backend */
      const response = await callAPI('tambahSiswaBaru', payloadSiswa);
      
      btnSimpan.disabled = false;
      btnSimpan.innerHTML = originalText;
      
      if(response.success) {
        Swal.fire({ icon: 'success', title: 'Berhasil', text: response.message, timer: 1500, showConfirmButton: false });
        formTambah.reset();
        
        const modalEl = document.getElementById('modalTambahSiswa');
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if(modalInstance) modalInstance.hide();
        
		refreshDataSiswa();
      } else {
        Swal.fire({ icon: 'error', title: 'Gagal Menyimpan', text: response.message });
      }

    } catch (err) {
      btnSimpan.disabled = false;
      btnSimpan.innerHTML = originalText;
      Swal.fire({ icon: 'warning', title: 'Validasi Gagal', text: err.message });
    }
  });
}

/* Fungsi memicu munculnya data lama di Form Edit */
function bukaModalEditSiswa(idSiswa) {
  const siswa = window.allSiswa.find(s => s.id_siswa === idSiswa);
  if(!siswa) {
    Swal.fire({ icon: 'error', title: 'Error', text: 'Data lokal siswa tidak ditemukan.' });
    return;
  }

  /* Isi data ke elemen form edit di Index.html */
  document.getElementById('edit-id-siswa').value = siswa.id_siswa;
  document.getElementById('e-foto-lama').value = siswa.url_foto || '';
  document.getElementById('e-nis').value = siswa.nis;
  document.getElementById('e-nisn').value = siswa.nisn??'';
  document.getElementById('e-nama').value = siswa.nama_lengkap;
  document.getElementById('e-nik').value = siswa.nik??'';
  document.getElementById('e-jk').value = siswa.jenis_kelamin || 'L';
  document.getElementById('e-status').value = siswa.status_siswa;
  document.getElementById('e-tingkat').value = siswa.tingkat_kelas;
  document.getElementById('e-rombel').value = siswa.rombel_kelas;
  document.getElementById('e-tempat-lahir').value = siswa.tempat_lahir || '';

  if(siswa.tanggal_lahir) {
    const d = new Date(siswa.tanggal_lahir);
    const month = ('0' + (d.getMonth() + 1)).slice(-2);
    const day = ('0' + d.getDate()).slice(-2);
    document.getElementById('e-tanggal-lahir').value = d.getFullYear() + '-' + month + '-' + day;
  } else {
    document.getElementById('e-tanggal-lahir').value = '';
  }

  document.getElementById('e-goldarah').value = siswa.gol_darah || '-';
  document.getElementById('e-alamat').value = siswa.alamat_lengkap || '';
  document.getElementById('e-wali').value = siswa.nama_wali_murid || '';
  document.getElementById('e-hp-wali').value = siswa.no_hp_wali || '';
  document.getElementById('e-email-wali').value = siswa.email_wali || '';
  document.getElementById('e-tele-wali').value = siswa.telegram_chat_id || '';

  /* Reset input file agar kosong secara default saat dibuka */
  document.getElementById('e-foto').value = '';

  const modalEdit = new bootstrap.Modal(document.getElementById('modalEditSiswa'));
  modalEdit.show();
}

/* Inisialisasi Event Listener Submit untuk Form Edit */
function initFormEditSiswa() {
  const formEdit = document.getElementById('form-edit-siswa');
  if(!formEdit) return;

  formEdit.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnUpdate = document.getElementById('btn-update-siswa');
    const originalText = btnUpdate.innerHTML;

    btnUpdate.disabled = true;
    btnUpdate.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Memperbarui...';

    try {
      const fileInput = document.getElementById('e-foto');
      let fotoObj = null;

      if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (file.size > 2 * 1024 * 1024) throw new Error("Ukuran foto baru melebihi batas 2MB.");

        const reader = new FileReader();
        reader.readAsDataURL(file);
        await new Promise(resolve => reader.onload = resolve);

        const stringBase64 = reader.result.split(',');
        fotoObj = {
          mimeType: stringBase64[0].match(/:(.*?);/)[1],
          base64: stringBase64[1]
        };
      }

      const idSiswa = document.getElementById('edit-id-siswa').value;
      const payloadUpdate = {
		nis: document.getElementById('e-nis').value,
        nisn: document.getElementById('e-nisn').value,
        nama_lengkap: document.getElementById('e-nama').value,
		nik: document.getElementById('e-nik').value,
		jenis_kelamin: document.getElementById('e-jk').value,
        status_siswa: document.getElementById('e-status').value,
        tingkat_kelas: document.getElementById('e-tingkat').value,
        rombel_kelas: document.getElementById('e-rombel').value,
        tempat_lahir: document.getElementById('e-tempat-lahir').value,
        tanggal_lahir: document.getElementById('e-tanggal-lahir').value,
        gol_darah: document.getElementById('e-goldarah').value,
        alamat_lengkap: document.getElementById('e-alamat').value,
        nama_wali_murid: document.getElementById('e-wali').value,
        no_hp_wali: document.getElementById('e-hp-wali').value,
        email_wali: document.getElementById('e-email-wali').value,
        telegram_chat_id: document.getElementById('e-tele-wali').value,
        url_foto_lama: document.getElementById('e-foto-lama').value,
        foto_upload: fotoObj
      };

      const response = await callAPI('updateSiswaData', { idSiswa: idSiswa, dataSiswa: payloadUpdate });
      
      btnUpdate.disabled = false;
      btnUpdate.innerHTML = originalText;
      
      if(response.success) {
        Swal.fire({ icon: 'success', title: 'Diperbarui', text: response.message, timer: 1500, showConfirmButton: false });
        
        const modalEl = document.getElementById('modalEditSiswa');
        const modalInstance = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
        if(modalInstance) modalInstance.hide();
        
		refreshDataSiswa();
      } else {
        Swal.fire({ icon: 'error', title: 'Gagal', text: response.message });
      }

    } catch (err) {
      btnUpdate.disabled = false;
      btnUpdate.innerHTML = originalText;
      Swal.fire({ icon: 'warning', title: 'Validasi Gagal', text: err.message });
    }
  });
}

/* =========================================================
   7. FUNGSI CETAK KARTU PELAJAR (ID CARD)
   ========================================================= */

const bulanIndo = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

async function eksekusiCetakKartu(idSiswa) {
  /* Ambil data siswa dari memori */
  const s = window.allSiswa.find(function(x) { return x.id_siswa === idSiswa; });
  if (!s) { Swal.fire('Error', 'Data siswa tidak ditemukan', 'error'); return; }
  
  Swal.fire({ title: 'Menyiapkan Dokumen...', text: 'Memproses kartu pelajar.', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

  /* Pastikan identitas sekolah sudah di-load */
  if (!window.identitasSekolah) {
    window.identitasSekolah = await callAPI('getIdentitasSekolah');
  }
  const idSekolah = window.identitasSekolah;

  const printWindow = window.open('', '', 'height=600,width=600');
  
  let htmlPrint = '<html><head><title>Cetak Kartu - ' + s.nama_lengkap + '</title>';
  htmlPrint += '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;700&display=swap" rel="stylesheet">';
  htmlPrint += '<style>';
  htmlPrint += 'body { display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: "Poppins", sans-serif; }';
  htmlPrint += '@page { margin: 0; }';
  
  /* Desain Kartu (Center Aligned) */
  htmlPrint += '.kartu { width: 54mm; height: 85.6mm; background: linear-gradient(135deg, #ffffff 0%, #f0f8ff 100%) !important; border: 1px solid #cdd4dc; border-radius: 8px; position: relative; overflow: hidden; box-sizing: border-box; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }';
  
  /* Kop dengan 2 Logo */
  htmlPrint += '.k-header { background-color: #0d6efd !important; color: white !important; padding: 8px 5px; display: flex; justify-content: space-between; align-items: center; }';
  htmlPrint += '.k-logo { width: 20px; height: 20px; object-fit: contain; }';
  htmlPrint += '.k-title-box { text-align: center; flex-grow: 1; line-height: 1.1; }';
  htmlPrint += '.k-title { font-size: 10px; font-weight: 700; letter-spacing: 0.5px; }';
  htmlPrint += '.k-subtitle { font-size: 7px; font-weight: 400; }';
  htmlPrint += '.k-npsn { font-size: 6px; font-weight: 300; }';
  
  /* Body (Center Aligned) */
  htmlPrint += '.k-body { padding: 10px; text-align: center; }';
  htmlPrint += '.k-foto { width: 60px; height: 80px; object-fit: cover; border-radius: 4px; border: 2px solid #0d6efd !important; margin-bottom: 6px; }';
  htmlPrint += '.k-nama { font-size: 11px; font-weight: 700; color: #1a1d20; margin-bottom: 10px; line-height: 1.1; text-transform: uppercase; }';
  htmlPrint += '.k-teks { font-size: 8px; font-weight: 500; color: #495057; margin-bottom: 0px; }';
  
  htmlPrint += '.bottom-info { position: absolute; bottom: 12px; left: 0; width: 100%; padding: 0 10px; box-sizing: border-box; display: flex; justify-content: space-between; align-items: flex-end; }';
  htmlPrint += '.qr-area { width: 55px; height: 55px; border: 1px solid #cdd4dc; padding: 2px; background: #fff; border-radius: 2px; }';
  htmlPrint += '.ttd-area { text-align: center; width: 100px; color: #1a1d20; }';
  htmlPrint += '.ttd-jabatan { font-size: 7px; font-weight: 600;  }';
  htmlPrint += '.ttd-images { position: relative; height: 30px; width: 100%; display: flex; justify-content: center; align-items: center; margin: 2px 0; }';
  htmlPrint += '.img-stempel { position: absolute; width: 40px; left: 0; opacity: 0.85; z-index: 2; transform: rotate(-5deg); }';
  htmlPrint += '.img-ttd { position: absolute; height: 30px; z-index: 1; }';
  htmlPrint += '.ttd-nama { font-size: 7px; font-weight: 600; }';
  htmlPrint += '.ttd-nip { font-size: 7px; }';
  
  htmlPrint += '.k-footer { background-color: #0d6efd !important; height: 8px; width: 100%; position: absolute; bottom: 0; }';
  htmlPrint += '</style></head><body>';

  /* Siapkan Data */
  let qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" + (s.id_siswa || '');
  const defaultFoto = 'data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2760%27 height=%2780%27 viewBox=%270 0 60 80%27><rect width=%27100%%27 height=%27100%%27 fill=%27%23e9ecef%27/><text x=%2750%%27 y=%2750%%27 dominant-baseline=%27middle%27 text-anchor=%27middle%27 font-family=%27sans-serif%27 font-size=%2710%27 fill=%27%236c757d%27>Foto</text></svg>';
  let fotoSiswa = s.url_foto ? s.url_foto : defaultFoto;
  
  let tglLahir = s.tanggal_lahir;
  if(tglLahir) {
    let d = new Date(tglLahir);
    //tglLahir = ('0' + d.getDate()).slice(-2) + ' ' + bulanIndo[d.getMonth()] + ' ' + d.getFullYear();
	tglLahir = ('0' + d.getDate()).slice(-2) + '-' + ('0' + d.getMonth()).slice(-2) + '-' + d.getFullYear();
  } else { tglLahir = "-"; }

  /* Render HTML Kartu */
  htmlPrint += '<div class="kartu">';
  htmlPrint += '<div class="k-header">';
  htmlPrint += '<img class="k-logo" src="' + idSekolah.logo_kiri + '">';
  htmlPrint += '<div class="k-title-box"><div class="k-title">KARTU PELAJAR</div><div class="k-subtitle">' + idSekolah.nama_sekolah + '</div><div class="k-npsn">NPSN : ' + idSekolah.npsn + '</div></div>';
  htmlPrint += '<img class="k-logo" src="' + idSekolah.logo_kanan + '">';
  htmlPrint += '</div>';
  
  htmlPrint += '<div class="k-body">';
  htmlPrint += '<img class="k-foto" src="' + fotoSiswa + '" alt="Foto">';
  htmlPrint += '<div class="k-nama">' + s.nama_lengkap + '</div>';
  htmlPrint += '<div class="k-teks">NIPD: ' + s.nis + '</div>';
  htmlPrint += '<div class="k-teks">NISN: ' + s.nisn??'' + '</div>';
  htmlPrint += '<div class="k-teks">NIK: ' + s.nik??'' + '</div>';
  htmlPrint += '<div class="k-teks">Jenis Kelamin: ' + (s.jenis_kelamin === 'P' ? 'Perempuan' : 'Laki-laki') + '</div>';
  htmlPrint += '<div class="k-teks">TTL: ' + (s.tempat_lahir || "-") + ', ' + tglLahir + '</div>';
  htmlPrint += '<div class="bottom-info">';
  htmlPrint += '<img class="qr-area" src="' + qrUrl + '">';
  htmlPrint += '<div class="ttd-area">';
  htmlPrint += '<div class="ttd-jabatan">Kepala Sekolah,</div>';
  htmlPrint += '<div class="ttd-images">';
  htmlPrint += '<img class="img-stempel" src="stempel.png" alt="" onerror="this.style.display=\'none\'">';
  htmlPrint += '<img class="img-ttd" src="' + idSekolah.nip_kepsek.replace(/ /g, "") + '.png" alt="" onerror="this.style.display=\'none\'">';
  htmlPrint += '</div>';
  htmlPrint += '<div class="ttd-nama"><u>' + idSekolah.nama_kepsek + '</u></div>';
  htmlPrint += '<div class="ttd-nip">NIP. ' + idSekolah.nip_kepsek + '</div>';
  htmlPrint += '</div>';
  htmlPrint += '</div>';
  htmlPrint += '</div>';
  
  htmlPrint += '<div class="k-footer"></div>';
  htmlPrint += '</div>';

  htmlPrint += '<script>setTimeout(function() { window.print(); window.close(); }, 1500);</script></body></html>';
  //htmlPrint += '</body></html>';
  
  printWindow.document.write(htmlPrint);
  printWindow.document.close();
  printWindow.focus();
  Swal.close(); 
}

/* ==========================================
   FITUR CETAK KARTU MASSAL (A4)
   ========================================== */

function bukaModalCetakMassal() {
  /* Ambil daftar kelas unik dari data yang sudah ada di memori */
  let kelasSet = {};
  for (let i = 0; i < window.allSiswa.length; i++) {
    if (window.allSiswa[i].status_siswa === 'Aktif') {
      kelasSet[window.allSiswa[i].tingkat_kelas + ' - ' + window.allSiswa[i].rombel_kelas] = true;
    }
  }
  let daftarKelas = Object.keys(kelasSet).sort();

  /* Masukkan ke dropdown modal */
  let opsiHtml = '<option value="SEMUA">Semua Siswa Aktif (Seluruh Kelas)</option>';
  for(let k = 0; k < daftarKelas.length; k++) {
    opsiHtml += '<option value="' + daftarKelas[k] + '">Hanya Kelas ' + daftarKelas[k] + '</option>';
  }
  document.getElementById('opsi-cetak-massal').innerHTML = opsiHtml;

  /* Tampilkan Modal */
  new bootstrap.Modal(document.getElementById('modalCetakMassal')).show();
}

async function eksekusiCetakMassal() {
  const targetKelas = document.getElementById('opsi-cetak-massal').value;
  const ukuranKertas = document.getElementById('opsi-ukuran-kertas').value;
  
  let targetSiswa = window.allSiswa.filter(function(s) { return s.status_siswa === 'Aktif'; });
  if (targetKelas !== 'SEMUA') {
    targetSiswa = targetSiswa.filter(function(s) { return (s.tingkat_kelas + ' - ' + s.rombel_kelas) === targetKelas; });
  }

  if (targetSiswa.length === 0) {
    Swal.fire('Kosong', 'Tidak ada siswa aktif di kelas tersebut.', 'warning');
    return;
  }

  bootstrap.Modal.getInstance(document.getElementById('modalCetakMassal')).hide();
  Swal.fire({ title: 'Menyiapkan Dokumen...', text: 'Memproses ' + targetSiswa.length + ' kartu pelajar.', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

  if (!window.identitasSekolah) {
    window.identitasSekolah = await callAPI('getIdentitasSekolah');
  }
  const idSekolah = window.identitasSekolah;

  const printWindow = window.open('', '', 'height=800,width=1000');
  
  let htmlPrint = '<html><head><title>Cetak Massal Kartu Pelajar</title>';
  htmlPrint += '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;700&display=swap" rel="stylesheet">';
  htmlPrint += '<style>';
  
  if (ukuranKertas === 'A4') {
    htmlPrint += '@page { size: A4; margin: 10mm; }';
    htmlPrint += '.grid-container { display: flex; flex-wrap: wrap; gap: 15px; justify-content: flex-start; }';
    htmlPrint += '.kartu { border: 1px solid #999; page-break-inside: avoid; }'; 
  } else {
    htmlPrint += '@page { size: 54mm 85.6mm; margin: 0; }';
    htmlPrint += '.grid-container { display: block; }';
    htmlPrint += '.kartu { border: none; page-break-after: always; }'; 
  }
  
  htmlPrint += 'body { font-family: "Poppins", sans-serif; margin: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }';
  
  /* Desain Kartu (Sama persis dengan Individu) */
  htmlPrint += '.kartu { width: 54mm; height: 85.6mm; background: linear-gradient(135deg, #ffffff 0%, #f0f8ff 100%) !important; border-radius: 8px; position: relative; overflow: hidden; box-sizing: border-box; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }';
  
  htmlPrint += '.k-header { background-color: #0d6efd !important; color: white !important; padding: 8px 5px; display: flex; justify-content: space-between; align-items: center; }';
  htmlPrint += '.k-logo { width: 20px; height: 20px; object-fit: contain; }';
  htmlPrint += '.k-title-box { text-align: center; flex-grow: 1; line-height: 1.1; }';
  htmlPrint += '.k-title { font-size: 10px; font-weight: 700; letter-spacing: 0.5px; }';
  htmlPrint += '.k-subtitle { font-size: 7px; font-weight: 400; }';
  
  htmlPrint += '.k-body { padding: 10px; text-align: center; }';
  htmlPrint += '.k-foto { width: 60px; height: 80px; object-fit: cover; border-radius: 4px; border: 2px solid #0d6efd !important; margin-bottom: 6px; }';
  htmlPrint += '.k-nama { font-size: 11px; font-weight: 700; color: #1a1d20; margin-bottom: 10px; line-height: 1.1; text-transform: uppercase; }';
  htmlPrint += '.k-teks { font-size: 8px; font-weight: 500; color: #495057; margin-bottom: 0px; }';
  
  htmlPrint += '.bottom-info { position: absolute; bottom: 12px; left: 0; width: 100%; padding: 0 10px; box-sizing: border-box; display: flex; justify-content: space-between; align-items: flex-end; }';
  htmlPrint += '.qr-area { width: 55px; height: 55px; border: 1px solid #cdd4dc; padding: 2px; background: #fff; border-radius: 2px; }';
  htmlPrint += '.ttd-area { text-align: center; width: 100px; color: #1a1d20; }';
  htmlPrint += '.ttd-jabatan { font-size: 7px; font-weight: 600;  }';
  htmlPrint += '.ttd-images { position: relative; height: 30px; width: 100%; display: flex; justify-content: center; align-items: center; margin: 2px 0; }';
  htmlPrint += '.img-stempel { position: absolute; width: 40px; left: 0; opacity: 0.85; z-index: 2; transform: rotate(-5deg); }';
  htmlPrint += '.img-ttd { position: absolute; height: 30px; z-index: 1; }';
  htmlPrint += '.ttd-nama { font-size: 7px; font-weight: 600; }';
  htmlPrint += '.ttd-nip { font-size: 7px; }';
  
  htmlPrint += '.k-footer { background-color: #0d6efd !important; height: 8px; width: 100%; position: absolute; bottom: 0; }';
  htmlPrint += '</style></head><body>';

  htmlPrint += '<div class="grid-container">';

  const defaultFoto = 'data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2760%27 height=%2780%27 viewBox=%270 0 60 80%27><rect width=%27100%%27 height=%27100%%27 fill=%27%23e9ecef%27/><text x=%2750%%27 y=%2750%%27 dominant-baseline=%27middle%27 text-anchor=%27middle%27 font-family=%27sans-serif%27 font-size=%2710%27 fill=%27%236c757d%27>Foto</text></svg>';

  for (let i = 0; i < targetSiswa.length; i++) {
    let s = targetSiswa[i];
    let qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" + (s.id_siswa || '');
    let fotoSiswa = s.url_foto ? s.url_foto : defaultFoto;
    
    let tglLahir = s.tanggal_lahir;
    if(tglLahir) {
      let d = new Date(tglLahir);
      tglLahir = ('0' + d.getDate()).slice(-2) + ' ' + bulanIndo[d.getMonth()] + ' ' + d.getFullYear();
    } else { tglLahir = "-"; }

    htmlPrint += '<div class="kartu">';
    htmlPrint += '<div class="k-header">';
    htmlPrint += '<img class="k-logo" src="' + idSekolah.logo_kiri + '">';
    htmlPrint += '<div class="k-title-box"><div class="k-title">KARTU PELAJAR</div><div class="k-subtitle">' + idSekolah.nama_sekolah + '</div></div>';
    htmlPrint += '<img class="k-logo" src="' + idSekolah.logo_kanan + '">';
    htmlPrint += '</div>';
    
    htmlPrint += '<div class="k-body">';
    htmlPrint += '<img class="k-foto" src="' + fotoSiswa + '" alt="Foto">';
    htmlPrint += '<div class="k-nama">' + s.nama_lengkap + '</div>';
	htmlPrint += '<div class="k-teks">NIPD: ' + s.nis + '</div>';
    htmlPrint += '<div class="k-teks">NISN: ' + s.nisn + '</div>';
	htmlPrint += '<div class="k-teks">NIK: ' + s.nik + '</div>';
	htmlPrint += '<div class="k-teks">JK: ' + (s.jenis_kelamin === 'P' ? 'Perempuan' : 'Laki-laki') + '</div>';
	htmlPrint += '<div class="k-teks">TTL: ' + (s.tempat_lahir || "-") + ', ' + tglLahir + '</div>';
	htmlPrint += '<div class="bottom-info">';
	htmlPrint += '<img class="qr-area" src="' + qrUrl + '">';
	htmlPrint += '<div class="ttd-area">';
	htmlPrint += '<div class="ttd-jabatan">Kepala Sekolah,</div>';
	htmlPrint += '<div class="ttd-images">';
	htmlPrint += '<img class="img-stempel" src="stempel.png" alt="" onerror="this.style.display=\'none\'">';
	htmlPrint += '<img class="img-ttd" src="' + idSekolah.nip_kepsek.trim() + '.png" alt="" onerror="this.style.display=\'none\'">';
	htmlPrint += '</div>';
	htmlPrint += '<div class="ttd-nama"><u>' + idSekolah.nama_kepsek + '</u></div>';
	htmlPrint += '<div class="ttd-nip">NIP. ' + idSekolah.nip_kepsek + '</div>';
	htmlPrint += '</div>';
	htmlPrint += '</div>';
    htmlPrint += '</div>';
    
    htmlPrint += '<div class="k-footer"></div>';
    htmlPrint += '</div>';
  }

  htmlPrint += '</div>';
  htmlPrint += '<script>setTimeout(function() { window.print(); window.close(); }, 3000);</script>';
  htmlPrint += '</body></html>';

  printWindow.document.write(htmlPrint);
  printWindow.document.close();
  printWindow.focus();
  Swal.close(); 
}

/* ==========================================
   8. AUTHENTICATION & SESSION MANAGEMENT
   ========================================== */
if (UI.form) {
  UI.form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;

    const originalBtnText = UI.btnSubmit.innerHTML;
    UI.btnSubmit.disabled = true;
    UI.btnSubmit.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Memproses...';

    try {
      /* Memanggil API menggunakan fungsi callAPI yang baru dibuat */
      const response = await callAPI('processLogin', { username: user, password: pass });

      if (response.success) {
        localStorage.setItem('sis_token', response.token);
        localStorage.setItem('sis_role', response.role);
        localStorage.setItem('sis_relasi_id', response.relasi_id);
        localStorage.setItem('sis_is_wali', response.is_wali_kelas ? 'Ya' : 'Bukan');
		localStorage.setItem('sis_nama_user', response.nama_user);
        
        if (response.force_change_pass) {
          localStorage.setItem('sis_force_pass', 'true');
        }
		
		localStorage.setItem('sis_periode_aktif', response.periode_aktif);
        localStorage.setItem('sis_daftar_partisi', response.daftar_partisi);
              
        const expiryTime = Date.now() + (12 * 60 * 60 * 1000);
        localStorage.setItem('sis_expiry', expiryTime);

        Swal.fire({ icon: 'success', title: 'Berhasil!', text: response.message, timer: 1500, showConfirmButton: false })
        .then(function() {
          UI.form.reset();
          checkAuthStatus();
          });
      } else {
        Swal.fire({ icon: 'error', title: 'Akses Ditolak', text: response.message });
      }
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Server Error', text: error.message });
    } finally {
      UI.btnSubmit.disabled = false;
      UI.btnSubmit.innerHTML = originalBtnText;
    }
  });
}

/* ==========================================
   LOGIKA GOOGLE SIGN-IN (SSO)
   ========================================== */

/* Callback yang dipanggil otomatis oleh Google setelah user memilih akun */
async function handleGoogleLogin(response) {
  /* AMBIL TOKEN MENTAH DARI GOOGLE (TIDAK PERLU DI-DECODE DI FRONTEND) */
  const googleIdToken = response.credential; 

  Swal.fire({ title: 'Memverifikasi Akun...', text: 'Menghubungkan ke server Google', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

  try {
    /* KIRIM TOKEN MENTAH KE BACKEND UNTUK DIVERIFIKASI */
    const res = await callAPI('processGoogleLogin', { id_token: googleIdToken });

    if (res.success) {
      localStorage.setItem('sis_token', res.token);
      localStorage.setItem('sis_role', res.role);
      localStorage.setItem('sis_relasi_id', res.relasi_id);
      localStorage.setItem('sis_is_wali', res.is_wali_kelas ? 'Ya' : 'Bukan');
      localStorage.setItem('sis_nama_user', res.nama_user);
      localStorage.setItem('sis_periode_aktif', res.periode_aktif);
      localStorage.setItem('sis_daftar_partisi', res.daftar_partisi);
            
      const expiryTime = Date.now() + (12 * 60 * 60 * 1000);
      localStorage.setItem('sis_expiry', expiryTime);

      Swal.fire({ icon: 'success', title: 'Berhasil!', text: res.message, timer: 1500, showConfirmButton: false })
      .then(function() {
        checkAuthStatus();
      });
    } else {
      Swal.fire({ icon: 'error', title: 'Akses Ditolak', text: res.message });
    }
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'Server Error', text: error.message });
  }
}

/* Fungsi Bantuan untuk membuat Dropdown Periode dengan Event onchange dinamis */
function generateDropdownPeriode(idElement, onChangeFunction) {
  const daftarPartisi = localStorage.getItem('sis_daftar_partisi') || localStorage.getItem('sis_periode_aktif');
  const periodeAktif = localStorage.getItem('sis_periode_aktif');
  const arrayPartisi = daftarPartisi.split(',');
  
  /* Tambahkan atribut onchange jika parameter onChangeFunction diberikan */
  let onchangeAttr = onChangeFunction ? ' onchange="' + onChangeFunction + '()"' : '';
  
  let html = '<select id="' + idElement + '" class="form-select border-0 shadow-sm"' + onchangeAttr + '>';
  
  for (let i = arrayPartisi.length - 1; i >= 0; i--) { /* Dibalik agar yang terbaru di atas */
    let p = arrayPartisi[i];
    let label = p.replace('_', ' Semester ').replace('_', '/');
    let selected = (p === periodeAktif) ? 'selected' : '';
    html += '<option value="' + p + '" ' + selected + '>' + label + (p === periodeAktif ? ' (Aktif)' : '') + '</option>';
  }
  
  html += '</select>';
  return html;
}

/* Fungsi Logout */
function handleLogout() {
  Swal.fire({
    title: 'Keluar dari sistem?',
    text: 'Sesi Anda akan dihapus dari perangkat ini dan server.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#4f46e5',
    cancelButtonColor: '#d33',
    confirmButtonText: 'Ya, Keluar',
    cancelButtonText: 'Batal'
  }).then(async (result) => {
    if (result.isConfirmed) {
      Swal.fire({ title: 'Memutuskan sesi...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
      
      try {
        await callAPI('processLogout', {});
      } catch (e) {
        console.warn("Server logout failed, proceeding with local logout.");
      }
      
      clearSession();
      Swal.close();
      showView('login');
    }
  });
}

function clearSession() {
  localStorage.removeItem('sis_token');
  localStorage.removeItem('sis_expiry');
  localStorage.removeItem('sis_role');
  localStorage.removeItem('sis_relasi_id');
}

/* ==========================================
   9. PENGATURAN SISTEM & KALENDER
   ========================================== */

/* ==========================================
   REDESIGN: PENGATURAN SISTEM (TABS UI)
   ========================================== */
/* Helper UI Libur Dinamis */
function renderListLibur() {
  const val = document.getElementById('k-libur').value;
  const arr = val ? val.split(',') : [];
  let html = '';
  if(arr.length === 0) html = '<span class="text-muted small">Belum ada tanggal libur.</span>';
  for(let i=0; i<arr.length; i++) {
    html += '<span class="badge bg-danger p-2 d-flex align-items-center gap-2 fs-6">'+arr[i]+'<i class="fa-solid fa-xmark" style="cursor:pointer;" onclick="hapusListLibur(\''+arr[i]+'\')"></i></span>';
  }
  document.getElementById('container-list-libur').innerHTML = html;
}

function tambahListLibur() {
  const tgl = document.getElementById('input-tambah-libur').value;
  if(!tgl) return;
  let val = document.getElementById('k-libur').value;
  let arr = val ? val.split(',') : [];
  if(!arr.includes(tgl)) { arr.push(tgl); arr.sort(); }
  document.getElementById('k-libur').value = arr.join(',');
  document.getElementById('input-tambah-libur').value = '';
  renderListLibur();
}

function hapusListLibur(tgl) {
  let val = document.getElementById('k-libur').value;
  let arr = val ? val.split(',') : [];
  arr = arr.filter(item => item !== tgl);
  document.getElementById('k-libur').value = arr.join(',');
  renderListLibur();
}

async function renderPengaturanSistem() {
  UI.contentView.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-warning"></div><p class="mt-2 text-muted">Memuat konfigurasi sistem...</p></div>';

  try {
    const [dataModul, dataKalender, dataIdentitas] = await Promise.all([
      callAPI('getModulAksesData'),
      callAPI('getPengaturanKalender'),
      callAPI('getIdentitasSekolah')
    ]);
    
    window.identitasSekolah = dataIdentitas;

    let html = '<div class="d-flex justify-content-between align-items-center mb-4 fade-in">';
    html += '<h4 class="fw-bold mb-0">Pengaturan Sistem</h4>';
    html += '</div>';

    /* NAV TABS BOOTSTRAP */
    html += '<ul class="nav nav-pills mb-4 fade-in" id="settingTabs" role="tablist">';
    html += '<li class="nav-item" role="presentation"><button class="nav-link active fw-bold px-4 rounded-pill" data-bs-toggle="pill" data-bs-target="#tab-identitas" type="button" role="tab"><i class="fa-solid fa-school me-2"></i>Identitas Sekolah</button></li>';
    html += '<li class="nav-item ms-2" role="presentation"><button class="nav-link fw-bold px-4 rounded-pill" data-bs-toggle="pill" data-bs-target="#tab-kalender" type="button" role="tab"><i class="fa-solid fa-calendar-days me-2"></i>Kalender Akademik</button></li>';
    /* UBAH NAMA TAB DI SINI */
    html += '<li class="nav-item ms-2" role="presentation"><button class="nav-link fw-bold px-4 rounded-pill" data-bs-toggle="pill" data-bs-target="#tab-modul" type="button" role="tab"><i class="fa-solid fa-shield-halved me-2"></i>Keamanan & Modul</button></li>';

    html += '<div class="tab-content fade-in" id="settingTabsContent">';

    /* TAB 1: IDENTITAS SEKOLAH */
    html += '<div class="tab-pane fade show active" id="tab-identitas" role="tabpanel">';
    html += '<div class="card shadow-sm border-0" style="border-radius: 15px; max-width: 800px;">';
    html += '<div class="card-body p-4 bg-light">';
    html += '<form id="form-identitas">';
	html += '<div class="row">';
	html += '<div class="col-md-6 mb-3"><label class="form-label small fw-bold text-secondary">Nama Sekolah</label><input type="text" id="id-nama" class="form-control border-0 py-2 shadow-sm" required></div>';
	html += '<div class="col-md-6 mb-3"><label class="form-label small fw-bold text-secondary">NPSN</label><input type="text" id="id-npsn" class="form-control border-0 py-2 shadow-sm" required></div>';
	html += '</div>'
    html += '<div class="mb-3"><label class="form-label small fw-bold text-secondary">Alamat Sekolah</label><textarea id="id-alamat" class="form-control border-0 py-2 shadow-sm" rows="2" required></textarea></div>';
    html += '<div class="row mb-3">';
    html += '<div class="col-md-6 mb-2"><label class="form-label small fw-bold text-secondary">Website</label><input type="text" id="id-web" class="form-control border-0 py-2 shadow-sm"></div>';
    html += '<div class="col-md-6 mb-2"><label class="form-label small fw-bold text-secondary">Email</label><input type="text" id="id-email" class="form-control border-0 py-2 shadow-sm"></div>';
    html += '</div>';
    html += '<div class="row mb-3">';
    html += '<div class="col-md-6 mb-2"><label class="form-label small fw-bold text-secondary">Nama Kepsek</label><input type="text" id="id-kepsek" class="form-control border-0 py-2 shadow-sm" required></div>';
    html += '<div class="col-md-6 mb-2"><label class="form-label small fw-bold text-secondary">NIP Kepsek</label><input type="text" id="id-nip" class="form-control border-0 py-2 shadow-sm" required></div>';
    html += '</div>';
    html += '<div class="row mb-4">';
    html += '<div class="col-md-6 mb-2"><label class="form-label small fw-bold text-secondary">URL Logo Kiri (Daerah)</label><input type="url" id="id-logo-kiri" class="form-control border-0 py-2 shadow-sm"></div>';
    html += '<div class="col-md-6 mb-2"><label class="form-label small fw-bold text-secondary">URL Logo Kanan (Sekolah)</label><input type="url" id="id-logo-kanan" class="form-control border-0 py-2 shadow-sm"></div>';
    html += '</div>';
    html += '<button type="submit" id="btn-simpan-identitas" class="btn btn-primary fw-bold py-2 px-4 shadow-sm"><i class="fa-solid fa-save me-2"></i>Simpan Identitas</button>';
    html += '</form></div></div></div>';

    /* TAB 2: KALENDER & SISTEM */
    html += '<div class="tab-pane fade" id="tab-kalender" role="tabpanel">';
    html += '<div class="card shadow-sm border-0" style="border-radius: 15px; max-width: 800px;">';
    html += '<div class="card-body p-4 bg-light">';
    html += '<form id="form-kalender">';
    
    /* PERUBAHAN LABEL & ID: Dari Semester menjadi Tahun Ajaran */
    html += '<div class="row mb-3">';
    html += '<div class="col-md-6"><label class="form-label small fw-bold text-secondary">Tgl Mulai Tahun Ajaran</label><input type="date" id="k-tgl-mulai-ta" class="form-control border-0 shadow-sm" value="'+(dataKalender.tgl_mulai_ta||'')+'" required></div>';
    html += '<div class="col-md-6"><label class="form-label small fw-bold text-secondary">Tgl Akhir Tahun Ajaran</label><input type="date" id="k-tgl-akhir-ta" class="form-control border-0 shadow-sm" value="'+(dataKalender.tgl_akhir_ta||'')+'" required></div>';
    html += '</div>';

    html += '<div class="mb-4"><label class="form-label small fw-bold text-secondary">Batas Maksimal Alpa (EWS Tahunan)</label><div class="input-group shadow-sm" style="max-width: 200px;"><input type="number" id="k-batas-alpa" class="form-control border-0" value="'+(dataKalender.batas_alpa||'3')+'" required><span class="input-group-text bg-white border-0">Hari</span></div></div>';

    html += '<div class="mb-4"><label class="form-label small fw-bold text-secondary">Hari Aktif Sekolah</label>';
    html += '<div class="d-flex flex-wrap gap-3 p-3 bg-white rounded shadow-sm">';
    const hariAktifArr = dataKalender.hari_aktif.split(',');
    const namaHari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    for (let i = 0; i < 7; i++) {
      let isChecked = hariAktifArr.includes(i.toString()) ? 'checked' : '';
      html += '<div class="form-check form-switch"><input class="form-check-input chk-hari" type="checkbox" value="' + i + '" id="hari' + i + '" ' + isChecked + '><label class="form-check-label small fw-medium" for="hari' + i + '">' + namaHari[i] + '</label></div>';
    }
    html += '</div></div>';
    
    /* UI LIBUR DINAMIS */
    html += '<div class="mb-4"><label class="form-label small fw-bold text-secondary">Tanggal Libur Nasional / Sekolah</label>';
    html += '<div class="d-flex gap-2 mb-2"><input type="date" id="input-tambah-libur" class="form-control border-0 shadow-sm"><button type="button" class="btn btn-success shadow-sm" onclick="tambahListLibur()"><i class="fa-solid fa-plus"></i></button></div>';
    html += '<div id="container-list-libur" class="d-flex flex-wrap gap-2 p-3 bg-white rounded shadow-sm min-vh-50"></div>';
    html += '<input type="hidden" id="k-libur" value="'+dataKalender.tanggal_libur+'">';
    html += '</div>';
    
    html += '<button type="submit" id="btn-simpan-kalender" class="btn btn-warning text-dark fw-bold py-2 px-4 shadow-sm"><i class="fa-solid fa-save me-2"></i>Simpan Pengaturan</button>';
    html += '</form></div></div></div>';

    /* TAB 3: KEAMANAN & MODUL */
    html += '<div class="tab-pane fade" id="tab-modul" role="tabpanel">';
	/* TAMBAHKAN KARTU KEAMANAN DI SINI */
    html += '<div class="card shadow-sm border-0 mb-4" style="border-radius: 15px; max-width: 800px;">';
    html += '<div class="card-body p-4 bg-light">';
    html += '<div class="row align-items-center">';
    html += '<div class="col-md-8">';
    html += '<label class="form-label fw-bold text-dark mb-1"><i class="fa-solid fa-key text-warning me-2"></i>Password Default User Baru</label>';
    html += '<p class="small text-muted mb-0">Password ini akan otomatis terisi saat Admin membuat akun baru. User akan dipaksa menggantinya saat pertama kali login.</p>';
    html += '</div>';
    html += '<div class="col-md-4">';
    html += '<input type="text" id="k-pass-default" class="form-control border-0 shadow-sm fw-bold text-center" value="'+(dataKalender.password_default||'Guru@98')+'">';
    html += '</div>';
    html += '</div></div></div>';
	/* Tabel Modul (Tetap sama) */
    html += '<div class="card shadow-sm border-0" style="border-radius: 15px;">';
    html += '<div class="card-header bg-white fw-bold py-3 border-0 d-flex justify-content-between align-items-center">';
    html += '<span>Konfigurasi Modul Sistem</span>';
    html += '<button class="btn btn-success fw-bold btn-sm shadow-sm" onclick="simpanPengaturanAkses()"><i class="fa-solid fa-save me-1"></i> Simpan Modul</button>';
    html += '</div>';
    html += '<div class="card-body p-0 table-responsive">';
    html += '<table class="table table-hover align-middle mb-0"><thead class="table-light"><tr><th width="10%">ID</th><th width="30%">Nama Modul</th><th width="20%">Status</th><th width="40%">Hak Akses (Role)</th></tr></thead><tbody id="tbody-modul">';
    for(let i = 0; i < dataModul.length; i++) {
      let m = dataModul[i];
      let isChecked = m.status_aktif === 'Aktif' ? 'checked' : '';
      html += '<tr>';
      html += '<td><span class="badge bg-secondary">' + m.id_modul + '</span></td>';
      html += '<td><strong>' + m.nama_modul + '</strong></td>';
      html += '<td><div class="form-check form-switch"><input class="form-check-input toggle-status" type="checkbox" data-id="' + m.id_modul + '" ' + isChecked + '><label class="form-check-label small text-muted ms-1">' + (m.status_aktif === 'Aktif' ? 'Aktif' : 'Nonaktif') + '</label></div></td>';
      html += '<td><input type="text" class="form-control form-control-sm border-0 shadow-sm input-role" data-id="' + m.id_modul + '" value="' + m.akses_role + '"></td>';
      html += '</tr>';
    }
    html += '</tbody></table></div></div></div>';

    html += '</div>'; /* End Tab Content */

    UI.contentView.innerHTML = html;
    
    /* Event Listeners (Tetap sama persis seperti kode Anda sebelumnya) */
    const toggles = document.querySelectorAll('.toggle-status');
    for(let t = 0; t < toggles.length; t++) {
      toggles[t].addEventListener('change', function() {
        this.nextElementSibling.innerText = this.checked ? 'Aktif' : 'Nonaktif';
      });
    }

    document.getElementById('form-kalender').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('btn-simpan-kalender');
      const oriText = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = 'Menyimpan...';

      const chkHari = document.querySelectorAll('.chk-hari:checked');
      let hariArr = [];
      for(let i=0; i<chkHari.length; i++) hariArr.push(chkHari[i].value);

      const payload = {
        hari_aktif: hariArr.join(','),
        tanggal_libur: document.getElementById('k-libur').value,
        tgl_mulai_ta: document.getElementById('k-tgl-mulai-ta').value, /* Variabel Baru */
        tgl_akhir_ta: document.getElementById('k-tgl-akhir-ta').value, /* Variabel Baru */
        batas_alpa: document.getElementById('k-batas-alpa').value
      };

      try {
        const res = await callAPI('simpanPengaturanKalender', payload);
        Swal.fire({ icon: 'success', title: 'Tersimpan', text: res.message, timer: 1500, showConfirmButton: false });
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = oriText;
      }
    });
    
    document.getElementById('id-nama').value = dataIdentitas.nama_sekolah;
	document.getElementById('id-npsn').value = dataIdentitas.npsn;
    document.getElementById('id-alamat').value = dataIdentitas.alamat_sekolah;
    document.getElementById('id-web').value = dataIdentitas.website;
    document.getElementById('id-email').value = dataIdentitas.email;
    document.getElementById('id-kepsek').value = dataIdentitas.nama_kepsek;
    document.getElementById('id-nip').value = dataIdentitas.nip_kepsek;
    document.getElementById('id-logo-kiri').value = dataIdentitas.logo_kiri;
    document.getElementById('id-logo-kanan').value = dataIdentitas.logo_kanan;

    document.getElementById('form-identitas').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('btn-simpan-identitas');
      const oriText = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = 'Menyimpan...';

      const payload = {
        nama_sekolah: document.getElementById('id-nama').value,
		npsn: document.getElementById('id-npsn').value,
        alamat_sekolah: document.getElementById('id-alamat').value,
        website_sekolah: document.getElementById('id-web').value,
        email_sekolah: document.getElementById('id-email').value,
        nama_kepsek: document.getElementById('id-kepsek').value,
        nip_kepsek: document.getElementById('id-nip').value,
        url_logo_kiri: document.getElementById('id-logo-kiri').value,
        url_logo_kanan: document.getElementById('id-logo-kanan').value
      };

      try {
        const res = await callAPI('simpanIdentitasSekolah', payload);
        Swal.fire({ icon: 'success', title: 'Tersimpan', text: res.message, timer: 1500, showConfirmButton: false });
        window.identitasSekolah = payload; 
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = oriText;
      }
    });
	renderListLibur();
  } catch (error) {
    Swal.fire('Akses Ditolak', error.message, 'error');
  }
}

async function simpanPengaturanAkses() {
  const payload = [];
  const rows = document.querySelectorAll('#tbody-modul tr');

  for(let i = 0; i < rows.length; i++) {
    let row = rows[i];
    let toggle = row.querySelector('.toggle-status');
    let inputRole = row.querySelector('.input-role');
    
    if(toggle && inputRole) {
      payload.push({
        id_modul: toggle.getAttribute('data-id'),
        status_aktif: toggle.checked ? 'Aktif' : 'Nonaktif',
        akses_role: inputRole.value.trim()
      });
    }
  }
  
  const passDefault = document.getElementById('k-pass-default').value;

  Swal.fire({
    title: 'Menyimpan Konfigurasi...',
    text: 'Mohon tunggu sebentar',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });

  try {
    /* Kirim 2 payload sekaligus ke Backend */
    const res = await callAPI('updateModulAksesData', {
      data_modul: payloadModul,
      password_default: passDefault
    });
    
    if(res.success) {
      Swal.fire({icon: 'success', title: 'Berhasil', text: res.message, timer: 1500, showConfirmButton: false});
      applyRBAC(); 
    } else {
      Swal.fire('Gagal Menyimpan', res.message, 'error');
    }
  } catch (error) {
    Swal.fire('Kesalahan Sistem', error.message, 'error');
  }
}

/* ==========================================
   10. MODUL PRESENSI UMUM (SCANNER QR)
   ========================================== */

function renderPresensiUmum() {
  let html = '<div class="d-flex justify-content-between align-items-center mb-3 fade-in">';
  html += '<h4 class="fw-bold mb-0">Presensi Umum (Scan QR)</h4>';
  html += '</div>';

  html += '<div class="row fade-in">';

  /* Kolom Kiri: Kamera Scanner & Pilihan Mode */
  html += '<div class="col-md-5 mb-4">';

  html += '<div class="btn-group w-100 mb-3 shadow-sm" role="group">';
  html += '<input type="radio" class="btn-check" name="modeScan" id="mode-masuk" value="MASUK" checked>';
  html += '<label class="btn btn-outline-success fw-bold py-2" for="mode-masuk"><i class="fa-solid fa-arrow-right-to-bracket me-2"></i>Absen MASUK</label>';
  html += '<input type="radio" class="btn-check" name="modeScan" id="mode-pulang" value="PULANG">';
  html += '<label class="btn btn-outline-danger fw-bold py-2" for="mode-pulang"><i class="fa-solid fa-arrow-right-from-bracket me-2"></i>Absen PULANG</label>';
  html += '</div>';

  html += '<div class="card shadow-sm border-0" style="border-radius: 15px; overflow: hidden;">';
  html += '<div class="card-header bg-dark text-white text-center fw-bold py-3"><i class="fa-solid fa-camera me-2"></i>Arahkan QR Code ke Kamera</div>';
  html += '<div class="card-body p-0 bg-light">';
  html += '<div id="reader" style="width: 100%; min-height: 300px;"></div>';
  html += '</div></div></div>';

  /* Kolom Kanan: Log Hasil Scan */
  html += '<div class="col-md-7">';
  html += '<div class="card shadow-sm border-0" style="border-radius: 15px;">';
  html += '<div class="card-header bg-white fw-bold py-3 border-0">Log Pemindaian Terakhir</div>';
  html += '<div class="card-body p-0 table-responsive" style="max-height: 400px; overflow-y: auto;">';
  html += '<table class="table table-hover align-middle mb-0"><thead class="table-light"><tr><th>Waktu</th><th>Nama Siswa</th><th>Kelas</th><th>Status</th></tr></thead><tbody id="log-scan-body">';
  html += '<tr><td colspan="4" class="text-center text-muted py-4 small">Belum ada data pindaian.</td></tr>';
  html += '</tbody></table></div></div></div>';

  html += '</div>';

  UI.contentView.innerHTML = html;

  setTimeout(startScanner, 500);
}

function startScanner() {
  if (isScanning) return;

  /* Konfigurasi Scanner */
  html5QrcodeScanner = new Html5QrcodeScanner("reader", { 
    fps: 10, 
    qrbox: {width: 250, height: 250},
    supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA]
  }, false);

  html5QrcodeScanner.render(onScanSuccess, onScanFailure);
  isScanning = true;
}

function stopScanner() {
  if (html5QrcodeScanner && isScanning) {
    html5QrcodeScanner.clear().then(function() {
      isScanning = false;
    }).catch(function(error) {
      console.error("Gagal mematikan kamera: ", error);
    });
  }
}

/* Fungsi yang dipanggil saat QR berhasil terbaca */
async function onScanSuccess(decodedText, decodedResult) {
  if (html5QrcodeScanner) html5QrcodeScanner.pause();

  try {
    const modeTerpilih = document.querySelector('input[name="modeScan"]:checked').value;

    /* Kirim data QR beserta Mode-nya ke Backend API */
    const result = await callAPI('catatPresensiScanner', { 
      qrString: decodedText, 
      modeScan: modeTerpilih 
    });
    
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.start();
    osc.stop(ctx.currentTime + 0.1);

    Swal.fire({
      icon: 'success',
      title: result.status + ' BERHASIL',
      html: '<strong>' + result.nama + '</strong><br>' + result.kelas + '<br>Waktu: ' + result.waktu,
      timer: 2000,
      showConfirmButton: false
    });

    const tbody = document.getElementById('log-scan-body');
    if (tbody.innerText.includes('Belum ada data')) tbody.innerHTML = '';
    
    let badgeColor = result.status === 'MASUK' ? 'bg-success' : 'bg-danger';
    let newRow = '<tr>';
    newRow += '<td><span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i>' + result.waktu + '</span></td>';
    newRow += '<td><strong>' + result.nama + '</strong></td>';
    newRow += '<td>' + result.kelas + '</td>';
    newRow += '<td><span class="badge ' + badgeColor + '">' + result.status + '</span></td>';
    newRow += '</tr>';
    
    tbody.insertAdjacentHTML('afterbegin', newRow);
    
    const maksimalBaris = 10;
    while (tbody.children.length > maksimalBaris) {
      tbody.removeChild(tbody.lastElementChild);
    }

  } catch (error) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.frequency.value = 200;
    osc.type = 'square';
    osc.start();
    osc.stop(ctx.currentTime + 0.3);

    Swal.fire({
      icon: 'error',
      title: 'Gagal',
      text: error.message,
      timer: 3000,
      showConfirmButton: false
    });
  } finally {
    setTimeout(function() {
      if (html5QrcodeScanner && isScanning) html5QrcodeScanner.resume();
    }, 2500);
  }
}

function onScanFailure(error) {
  /* Abaikan error ini, karena library akan terus melempar error selama QR belum pas di kamera */
}

/* ==========================================
   11. MODUL MASTER DATA GURU
   ========================================== */

/* Menampilkan/Menyembunyikan input Rombel jika dipilih 'Ya' */
function setupWaliKelasToggle() {
  const isWaliAdd = document.getElementById('g-is-wali');
  const rombelAdd = document.getElementById('g-rombel-container');
  if(isWaliAdd) {
    isWaliAdd.addEventListener('change', function() {
      rombelAdd.style.display = this.value === 'Ya' ? 'block' : 'none';
    });
  }

  const isWaliEdit = document.getElementById('eg-is-wali');
  const rombelEdit = document.getElementById('eg-rombel-container');
  if(isWaliEdit) {
    isWaliEdit.addEventListener('change', function() {
      rombelEdit.style.display = this.value === 'Ya' ? 'block' : 'none';
    });
  }
}

async function renderMasterGuru() {
  UI.contentView.innerHTML = '<div class="d-flex justify-content-between align-items-center mb-3 fade-in"><h4 class="fw-bold mb-0">Master Data Guru</h4><button class="btn btn-primary btn-sm" disabled><i class="fa-solid fa-spinner fa-spin me-1"></i> Memuat...</button></div><div class="card shadow-sm border-0"><div class="card-body text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted">Mengambil data dari server...</p></div></div>';

  try {
    const [dataGuru, daftarKelas] = await Promise.all([
      callAPI('getGuruData', { status: "Aktif"}),
      callAPI('getDaftarKelasDistinct')
    ]);

    window.allGuru = dataGuru;

    let opsiKelasHtml = '<option value="" disabled selected>Pilih Kelas...</option>';
    for (let k = 0; k < daftarKelas.length; k++) {
      opsiKelasHtml += '<option value="' + daftarKelas[k] + '">' + daftarKelas[k] + '</option>';
    }

    const selectTambah = document.getElementById('g-rombel');
    const selectEdit = document.getElementById('eg-rombel');
    if (selectTambah) selectTambah.innerHTML = opsiKelasHtml;
    if (selectEdit) selectEdit.innerHTML = opsiKelasHtml;

    let tableRows = '';
    if (!dataGuru || dataGuru.length === 0) {
      tableRows = '<tr><td colspan="6" class="text-center text-muted py-4">Belum ada data guru.</td></tr>';
    } else {
      for (let i = 0; i < dataGuru.length; i++) {
        let g = dataGuru[i];
        let badgeWali = g.is_wali_kelas === 'Ya' ? '<span class="badge bg-info text-dark">Wali Kelas (' + g.wali_kelas_rombel + ')</span>' : '<span class="badge bg-secondary">Bukan</span>';

        tableRows += '<tr>';
        tableRows += '<td>' + (i + 1) + '</td>';
		tableRows += '<td><strong>' + g.nik + '</strong></td>';
        tableRows += '<td><strong>' + g.nip + '</strong></td>';
        tableRows += '<td>' + g.nama_guru + '</td>';
        tableRows += '<td>' + badgeWali + '</td>';
        tableRows += '<td><button class="btn btn-sm btn-warning text-dark" onclick="bukaModalEditGuru(\'' + g.id_guru + '\')"><i class="fa-solid fa-pen"></i> Edit</button></td>';
        tableRows += '</tr>';
      }
    }

    let html = '<div class="d-flex justify-content-between align-items-center mb-3 fade-in">';
    html += '<h4 class="fw-bold mb-0">Master Data Guru</h4>';
    html += '<button class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#modalTambahGuru"><i class="fa-solid fa-plus me-1"></i> Tambah Guru</button></div>';

	/* UI Dropdown Filter */
      html += '<div class="row mb-3 fade-in">';
      html += '<div class="col-md-3 mb-2">';
      html += '<select id="filter-status-guru" class="form-select border-0 shadow-sm" onchange="eksekusiFilterGuru()">';
      html += '<option value="SEMUA">Semua Status</option>';
      html += '<option value="Aktif" selected>Aktif</option>';
	  html += '<option value="Pindah">Pindah Tugas</option>';
	  html += '<option value="Pensiun">Pensiun</option>';
	  html += '<option value="Meninggal">Meninggal</option>';
	  html += '<option value="Diberhentikan">Diberhentikan</option>';
      html += '</select></div>';
      html += '</div>';

	html += '<div class="card shadow-sm border-0 fade-in">';
    html += '<div class="card-body p-3 table-responsive">';

    html += '<table id="tabel-guru" class="table table-hover align-middle mb-0">';
    html += '<thead class="table-light">';
    html += '<tr><th>No</th><th>NIK</th><th>NIP</th><th>Nama Guru</th><th>Status Wali Kelas</th><th>Aksi</th></tr></thead><tbody id="tbody-guru">';

    html += tableRows;
    html += '</tbody></table></div></div>';

    UI.contentView.innerHTML = html;
    
    /* Render Isi Tabel Pertama Kali */
    renderIsiTabelGuru(window.allGuru);
  }
  catch (error) {
    Swal.fire('Error', error.message, 'error');
  }
}

async function eksekusiFilterGuru() {
  const valStatus = document.getElementById('filter-status-guru').value;

  /* Tampilkan loading di tabel */
  if (dataTableGuruInstance) {
    dataTableGuruInstance.destroy();
    dataTableGuruInstance = null;
  }
  document.getElementById('tbody-guru').innerHTML = '<tr><td colspan="6" class="text-center py-5"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Menyaring data dari server...</td></tr>';

  try {
    /* Minta data ke backend dengan parameter filter */
    const payloadFilter = { status: valStatus };
    const filteredData = await callAPI('getGuruData', payloadFilter);
    
    /* Simpan ke memori lokal untuk keperluan Edit/Cetak */
    window.allGuru = filteredData;
    
    /* Render ulang tabel */
    renderIsiTabelGuru(filteredData);
  } catch (error) {
    Swal.fire('Gagal Menyaring Data', error.message, 'error');
    document.getElementById('tbody-siswa').innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Gagal memuat data.</td></tr>';
  }
}

function renderIsiTabelGuru(dataArray) {
  /* Hancurkan instance DataTable lama jika ada agar tidak error saat di-render ulang */
  if (dataTableGuruInstance) {
    dataTableGuruInstance.destroy();
    dataTableGuruInstance = null;
  }

  let tableRows = '';
  if (!dataArray || dataArray.length === 0) {
    tableRows = '<tr><td colspan="6" class="text-center text-muted py-4">Tidak ada data yang sesuai dengan filter.</td></tr>';
  } else {
    for (let i = 0; i < dataArray.length; i++) {
        let g = dataArray[i];
        let badgeWali = g.is_wali_kelas === 'Ya' ? '<span class="badge bg-info text-dark">Wali Kelas (' + g.wali_kelas_rombel + ')</span>' : '<span class="badge bg-secondary">Bukan</span>';

        tableRows += '<tr>';
        tableRows += '<td>' + (i + 1) + '</td>';
		tableRows += '<td><strong>' + g.nik + '</strong></td>';
        tableRows += '<td><strong>' + g.nip + '</strong></td>';
        tableRows += '<td>' + g.nama_guru + '</td>';
        tableRows += '<td>' + badgeWali + '</td>';
        tableRows += '<td><button class="btn btn-sm btn-warning text-dark" title="Edit" onclick="bukaModalEditGuru(\'' + g.id_guru + '\')"><i class="fa-solid fa-pen"></i></button></td>';
        tableRows += '</tr>';
      }
  }

  document.getElementById('tbody-guru').innerHTML = tableRows;

  /* Inisialisasi ulang DataTable jika ada data */
  if (dataArray && dataArray.length > 0) {
    const tableElement = document.getElementById('tabel-guru');
    dataTableGuruInstance = new simpleDatatables.DataTable(tableElement, {
      searchable: true,
      fixedHeight: false,
      perPage: 10,
	  columns: [
		{
			select: 0, 
			sortable: false,
			searchable: false,
			render: function (data, td, rowIndex, cellIndex) {
                return (rowIndex + 1).toString();
            }
		},
		{ select: 3, sort: "asc" },
		{ select: 5, sortable: false, searchable: false }
	  ],
      labels: {
        placeholder: "Cari NIK / NIP / Nama...",
        perPage: "data per halaman",
        noRows: "Tidak ada data ditemukan",
        info: "Menampilkan {start} sampai {end} dari {rows} data"
      }
    });
  }
}

function initFormTambahGuru() {
  const form = document.getElementById('form-tambah-guru');
  if(!form) return;

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-simpan-guru');
    const oriText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = 'Menyimpan...';

    const payload = {
      nik: document.getElementById('g-nik').value,
	  nip: document.getElementById('g-nip').value,
      nama_guru: document.getElementById('g-nama').value,
	  status_guru: document.getElementById('g-status').value,
      is_wali_kelas: document.getElementById('g-is-wali').value,
      wali_kelas_rombel: document.getElementById('g-is-wali').value === 'Ya' ? document.getElementById('g-rombel').value : ''
    };

    try {
      const res = await callAPI('tambahGuruBaru', payload);
      Swal.fire({ icon: 'success', title: 'Berhasil', text: res.message, timer: 1500, showConfirmButton: false });
      form.reset();
      document.getElementById('g-rombel-container').style.display = 'none';
      bootstrap.Modal.getInstance(document.getElementById('modalTambahGuru')).hide();
      renderMasterGuru();
    } catch (err) {
      Swal.fire('Gagal', err.message, 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = oriText;
    }
  });
}

function bukaModalEditGuru(idGuru) {
  const guru = window.allGuru.find(function(g) { return g.id_guru === idGuru; });
  if(!guru) return;

  document.getElementById('edit-id-guru').value = guru.id_guru;
  document.getElementById('eg-nik').value = guru.nik;
  document.getElementById('eg-nip').value = guru.nip;
  document.getElementById('eg-nama').value = guru.nama_guru;
  document.getElementById('eg-status').value = guru.status_guru;
  document.getElementById('eg-is-wali').value = guru.is_wali_kelas;

  const rombelContainer = document.getElementById('eg-rombel-container');
  if(guru.is_wali_kelas === 'Ya') {
    rombelContainer.style.display = 'block';
    document.getElementById('eg-rombel').value = guru.wali_kelas_rombel;
  } else {
    rombelContainer.style.display = 'none';
    document.getElementById('eg-rombel').value = '';
  }

  new bootstrap.Modal(document.getElementById('modalEditGuru')).show();
}

function initFormEditGuru() {
  const form = document.getElementById('form-edit-guru');
  if(!form) return;

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-update-guru');
    const oriText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = 'Update...';

    const idGuru = document.getElementById('edit-id-guru').value;
    const payload = {
      nik: document.getElementById('eg-nik').value,
	  nip: document.getElementById('eg-nip').value,
      nama_guru: document.getElementById('eg-nama').value,
	  status_guru: document.getElementById('eg-status').value,
      is_wali_kelas: document.getElementById('eg-is-wali').value,
      wali_kelas_rombel: document.getElementById('eg-is-wali').value === 'Ya' ? document.getElementById('eg-rombel').value : ''
    };

    try {
      const res = await callAPI('updateGuruData', { idGuru: idGuru, dataGuru: payload });
      Swal.fire({ icon: 'success', title: 'Berhasil', text: res.message, timer: 1500, showConfirmButton: false });
      bootstrap.Modal.getInstance(document.getElementById('modalEditGuru')).hide();
      renderMasterGuru();
    } catch (err) {
      Swal.fire('Gagal', err.message, 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = oriText;
    }
  });
}

/* ==========================================
   12. MODUL JURNAL MENGAJAR (DENGAN RIWAYAT)
   ========================================== */

let dataTableJurnalInstance = null;

async function renderJurnalMengajar() {
  UI.contentView.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted">Memuat antarmuka jurnal...</p></div>';

  try {
    const daftarKelas = await callAPI('getDaftarKelasDistinct');

    let html = '<div class="d-flex justify-content-between align-items-center mb-3 fade-in">';
    html += '<h4 class="fw-bold mb-0">Jurnal & Presensi Kelas</h4>';
    html += '</div>';

    /* Navigasi Tabs Bootstrap */
    html += '<ul class="nav nav-pills mb-4 fade-in" id="jurnalTabs" role="tablist">';
    html += '<li class="nav-item" role="presentation">';
    html += '<button class="nav-link active fw-bold px-4 rounded-pill" id="tab-buat-jurnal" data-bs-toggle="pill" data-bs-target="#pane-buat-jurnal" type="button" role="tab"><i class="fa-solid fa-pen-to-square me-2"></i>Buat Jurnal Baru</button>';
    html += '</li>';
    html += '<li class="nav-item ms-2" role="presentation">';
    html += '<button class="nav-link fw-bold px-4 rounded-pill" id="tab-riwayat-jurnal" data-bs-toggle="pill" data-bs-target="#pane-riwayat-jurnal" type="button" role="tab"><i class="fa-solid fa-clock-rotate-left me-2"></i>Riwayat Jurnal</button>';
    html += '</li>';
    html += '</ul>';

    html += '<div class="tab-content" id="jurnalTabsContent">';

    /* TAB 1: BUAT JURNAL BARU */
    html += '<div class="tab-pane fade show active" id="pane-buat-jurnal" role="tabpanel">';
    html += '<div class="row fade-in">';
    
    /* Kolom Kiri: Form Jurnal */
    html += '<div class="col-md-4 mb-4">';
    html += '<div class="card shadow-sm border-0" style="border-radius: 15px;">';
    html += '<div class="card-header bg-primary text-white fw-bold py-3 border-0">Data Jurnal</div>';
    html += '<div class="card-body bg-light">';
    html += '<form id="form-jurnal">';
    
    const todayStr = new Date().toISOString().split('T')[0];
    
    html += '<div class="mb-3"><label class="form-label small fw-bold text-secondary">Tanggal Jurnal</label>';
    html += '<input type="date" id="j-tanggal" class="form-control border-0 py-2 shadow-sm" value="' + todayStr + '" required onchange="resetTabelSiswa()"></div>';
    html += '<div class="mb-3"><label class="form-label small fw-bold text-secondary">Pilih Kelas</label>';
    html += '<select id="j-kelas" class="form-select border-0 py-2 shadow-sm" required onchange="loadSiswaUntukAbsen(this.value)">';
    html += '<option value="" disabled selected>-- Pilih Kelas --</option>';
    
    for(let k = 0; k < daftarKelas.length; k++) {
      html += '<option value="' + daftarKelas[k] + '">' + daftarKelas[k] + '</option>';
    }
    
    html += '</select></div>';
    html += '<div class="mb-3"><label class="form-label small fw-bold text-secondary">Mata Pelajaran</label>';
    html += '<input type="text" id="j-mapel" class="form-control border-0 py-2 shadow-sm" required></div>';
    html += '<div class="mb-3"><label class="form-label small fw-bold text-secondary">Jam Pelajaran Ke-</label>';
    html += '<input type="text" id="j-jam" class="form-control border-0 py-2 shadow-sm" required></div>';
    html += '<div class="mb-4"><label class="form-label small fw-bold text-secondary">Topik / Materi Pembelajaran</label>';
    html += '<textarea id="j-topik" class="form-control border-0 py-2 shadow-sm" rows="3" required></textarea></div>';
	html += '<div class="mb-4"><label class="form-label small fw-bold text-secondary">Catatan</label>';
    html += '<textarea id="j-catatan" class="form-control border-0 py-2 shadow-sm" rows="3"></textarea></div>';
    html += '<button type="submit" id="btn-simpan-jurnal" class="btn btn-success w-100 fw-bold py-2 shadow-sm" disabled><i class="fa-solid fa-save me-2"></i>Simpan Jurnal</button>';
    html += '</form></div></div></div>';

    /* Kolom Kanan: Daftar Siswa */
    html += '<div class="col-md-8">';
    html += '<div class="card shadow-sm border-0" style="border-radius: 15px;">';
    html += '<div class="card-header bg-white fw-bold py-3 border-0 d-flex justify-content-between align-items-center">';
    html += '<span>Daftar Siswa</span><span id="badge-jumlah-siswa" class="badge bg-primary rounded-pill">0 Siswa</span></div>';
    html += '<div class="card-body p-0 table-responsive" style="max-height: 65vh; overflow-y: auto;">';
    html += '<table class="table table-hover align-middle mb-0"><thead class="table-light" style="position: sticky; top: 0; z-index: 2;">';
    html += '<tr><th width="5%">No</th><th width="45%">Nama Siswa</th><th width="50%" class="text-center">Status Kehadiran</th></tr></thead>';
    html += '<tbody id="tbody-absen-mapel">';
    html += '<tr><td colspan="3" class="text-center text-muted py-5"><i class="fa-solid fa-arrow-left me-2"></i>Silakan pilih kelas terlebih dahulu.</td></tr>';
    html += '</tbody></table></div></div></div>';
    html += '</div></div>'; 

    /* TAB 2: RIWAYAT JURNAL */
    html += '<div class="tab-pane fade" id="pane-riwayat-jurnal" role="tabpanel">';
    
    const today = new Date();
    const currentMonthStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');

    html += '<div class="d-flex justify-content-between align-items-center mb-3">';
    html += '<h6 class="fw-bold text-secondary mb-0">Daftar Jurnal Anda</h6>';
    
    html += '<div class="d-flex gap-2">';
	html += generateDropdownPeriode('filter-periode-jurnal', 'loadRiwayatJurnal');
    html += '<input type="month" id="filter-bulan-jurnal" class="form-control form-control-sm border-0 shadow-sm" value="' + currentMonthStr + '" onchange="loadRiwayatJurnal()" title="Pilih Bulan">';
    html += '<button class="btn btn-success btn-sm shadow-sm text-nowrap" onclick="cetakJurnalMengajar()"><i class="fa-solid fa-print me-1"></i> Cetak Jurnal</button>';
    html += '</div>';
    html += '</div>';

    html += '<div class="card shadow-sm border-0 fade-in"><div class="card-body p-3 table-responsive">';
    html += '<table id="tabel-riwayat-jurnal" class="table table-hover align-middle mb-0"><thead class="table-light">';
    html += '<tr><th>Tanggal</th><th>Guru</th><th>Kelas</th><th>Mapel (Jam)</th><th>Topik Materi</th><th>Aksi</th></tr></thead>';
    html += '<tbody id="tbody-riwayat-jurnal">';
    html += '<tr><td colspan="6" class="text-center text-muted py-5">Klik tab ini untuk memuat data...</td></tr>';
    html += '</tbody></table></div></div>';
    html += '</div>'; 

    UI.contentView.innerHTML = html;

    document.getElementById('form-jurnal').addEventListener('submit', prosesSimpanJurnal);
    
    const tabRiwayatJurnal = document.getElementById('tab-riwayat-jurnal');
    if (tabRiwayatJurnal) {
      tabRiwayatJurnal.addEventListener('shown.bs.tab', loadRiwayatJurnal);
    }

  } catch (error) {
    Swal.fire('Error', error.message, 'error');
  }
}

/* Fungsi memuat data riwayat jurnal berdasarkan bulan */
function loadRiwayatJurnal() {
  setTimeout(async () => {
    const filterBulan = document.getElementById('filter-bulan-jurnal');
	const filterPeriode = document.getElementById('filter-periode-jurnal');
    
    if (!filterBulan) return;
    const bulanValue = filterBulan.value;
    if (!bulanValue) return;

    filterBulan.disabled = true;
	if(filterPeriode) filterPeriode.disabled = true;

    if (typeof dataTableJurnalInstance !== 'undefined' && dataTableJurnalInstance) {
      dataTableJurnalInstance.destroy();
      dataTableJurnalInstance = null;
    }

    const tbody = document.getElementById('tbody-riwayat-jurnal');
    if (!tbody) {
      filterBulan.disabled = false;
      if(filterPeriode) filterPeriode.disabled = false;
      return;
    }
    
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Mengambil riwayat jurnal...</td></tr>';

    try {
      const payload = { 
        bulan: bulanValue,
        periode: filterPeriode ? filterPeriode.value : localStorage.getItem('sis_periode_aktif')
      };
      const dataRiwayat = await callAPI('getRiwayatJurnal', payload);
      window.riwayatJurnal = dataRiwayat; 

      let tableRows = '';
      if (!dataRiwayat || dataRiwayat.length === 0) {
        tableRows = '<tr><td colspan="6" class="text-center text-muted py-4">Belum ada riwayat jurnal di bulan ini.</td></tr>';
      } else {
        for (let i = 0; i < dataRiwayat.length; i++) {
          let r = dataRiwayat[i];
          let d = new Date(r.tanggal);
          let tglIndo = ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + d.getFullYear();

          tableRows += '<tr>';
          tableRows += '<td><span class="badge bg-light text-dark border"><i class="fa-regular fa-calendar me-1"></i>' + tglIndo + '</span></td>';
          tableRows += '<td><strong>' + r.nama_guru + '</strong></td>';
          tableRows += '<td>' + r.kelas + '</td>';
          tableRows += '<td><div class="fw-bold text-primary">' + r.mapel + '</div><small class="text-muted">Jam ke: ' + r.jam + '</small></td>';
          tableRows += '<td><div style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="' + r.topik + '">' + r.topik + '</div></td>';
          tableRows += '<td><div class="btn-group font-monospace">';
		  if (!filterPeriode || filterPeriode.value === localStorage.getItem('sis_periode_aktif')){
			  tableRows += '<button class="btn btn-sm btn-outline-warning text-dark" onclick="bukaModalEditJurnal(\'' + r.id_sesi + '\')"><i class="fa-solid fa-pen"></i></button>';
			tableRows += '<button class="btn btn-sm btn-outline-danger" onclick="hapusJurnal(\'' + r.id_sesi + '\')"><i class="fa-solid fa-trash"></i></button>';
		  }
		  else{
			  tableRows += '<span class="badge bg-secondary">Arsip</span>';
		  }
          
		  tableRows += '</div></td>';
          tableRows += '</tr>';
        }
      }

      tbody.innerHTML = tableRows;

      const tableElement = document.getElementById('tabel-riwayat-jurnal');
      if (tableElement && dataRiwayat.length > 0) {
        dataTableJurnalInstance = new simpleDatatables.DataTable(tableElement, {
          searchable: true, fixedHeight: false, perPage: 10,
          labels: { placeholder: "Cari...", perPage: "data per halaman", noRows: "Tidak ada data", info: "Menampilkan {start} sampai {end} dari {rows} data" }
        });
      }

    } catch (error) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">' + error.message + '</td></tr>';
    } finally {
      filterBulan.disabled = false;
	  if(filterPeriode) filterPeriode.disabled = false;
    }
  }, 50);
}
  
/* Fungsi membuka Modal Edit Jurnal */
async function bukaModalEditJurnal(idSesi) {
  const jurnal = window.riwayatJurnal.find(function(j) { return j.id_sesi === idSesi; });
  if(!jurnal) return;

  document.getElementById('ej-id-sesi').value = jurnal.id_sesi;
  document.getElementById('ej-tanggal').value = jurnal.tanggal;
  document.getElementById('ej-kelas').value = jurnal.kelas;
  document.getElementById('ej-kelas-display').value = jurnal.kelas;
  document.getElementById('ej-mapel').value = jurnal.mapel;
  document.getElementById('ej-jam').value = jurnal.jam;
  document.getElementById('ej-topik').value = jurnal.topik;
  document.getElementById('ej-catatan').value = jurnal.catatan;

  const tbody = document.getElementById('tbody-edit-absen');
  tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Memuat data siswa...</td></tr>';

  new bootstrap.Modal(document.getElementById('modalEditJurnal')).show();

  try {
    const dataSiswa = await callAPI('getSiswaByKelas', { namaKelas: jurnal.kelas, tanggal: jurnal.tanggal });
    
    let absenTersimpan = [];
    try {
      absenTersimpan = JSON.parse(jurnal.absen_json);
    } catch (e) {
      console.error("Gagal parsing JSON absen:", e);
    }

    let rowsHtml = '';
    for (let i = 0; i < dataSiswa.length; i++) {
      let s = dataSiswa[i];
      
      let statusSiswa = 'Hadir'; 
      let dataAbsenSiswa = absenTersimpan.find(function(a) { return a.nis.toString() === s.nis.toString(); });
      if (dataAbsenSiswa) {
        statusSiswa = dataAbsenSiswa.status;
      }
      
      rowsHtml += '<tr>';
      rowsHtml += '<td>' + (i + 1) + '</td>';
      rowsHtml += '<td><div class="fw-bold">' + s.nama_lengkap + '</div><small class="text-muted">' + s.nis + '</small></td>';
      rowsHtml += '<td class="text-center">';
      rowsHtml += '<div class="btn-group shadow-sm" role="group">';
      
      let chkH = statusSiswa === 'Hadir' ? 'checked' : '';
      let chkS = statusSiswa === 'Sakit' ? 'checked' : '';
      let chkI = statusSiswa === 'Izin' ? 'checked' : '';
      let chkA = statusSiswa === 'Alpa' ? 'checked' : '';
      
      rowsHtml += '<input type="radio" class="btn-check edit-radio-absen" name="e_absen_' + s.nis + '" id="eh_' + s.nis + '" value="Hadir" data-nis="' + s.nis + '" ' + chkH + '>';
      rowsHtml += '<label class="btn btn-outline-success btn-sm px-3" for="eh_' + s.nis + '">H</label>';
      
      rowsHtml += '<input type="radio" class="btn-check edit-radio-absen" name="e_absen_' + s.nis + '" id="es_' + s.nis + '" value="Sakit" data-nis="' + s.nis + '" ' + chkS + '>';
      rowsHtml += '<label class="btn btn-outline-warning btn-sm px-3" for="es_' + s.nis + '">S</label>';
      
      rowsHtml += '<input type="radio" class="btn-check edit-radio-absen" name="e_absen_' + s.nis + '" id="ei_' + s.nis + '" value="Izin" data-nis="' + s.nis + '" ' + chkI + '>';
      rowsHtml += '<label class="btn btn-outline-info btn-sm px-3" for="ei_' + s.nis + '">I</label>';
      
      rowsHtml += '<input type="radio" class="btn-check edit-radio-absen" name="e_absen_' + s.nis + '" id="ea_' + s.nis + '" value="Alpa" data-nis="' + s.nis + '" ' + chkA + '>';
      rowsHtml += '<label class="btn btn-outline-danger btn-sm px-3" for="ea_' + s.nis + '">A</label>';
      
      rowsHtml += '</div></td></tr>';
    }

    tbody.innerHTML = rowsHtml;

  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-4">Gagal memuat data siswa: ' + error.message + '</td></tr>';
  }
}

/* Event Listener Form Edit Jurnal */
document.addEventListener("DOMContentLoaded", function() {
  const formEditJurnal = document.getElementById('form-edit-jurnal');
  if(formEditJurnal) {
    formEditJurnal.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('btn-update-jurnal');
      const oriText = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = 'Menyimpan...';

      const radioTerpilih = document.querySelectorAll('.edit-radio-absen:checked');
      let dataAbsenArray = [];
      for (let i = 0; i < radioTerpilih.length; i++) {
        dataAbsenArray.push({
          nis: radioTerpilih[i].getAttribute('data-nis'),
          status: radioTerpilih[i].value
        });
      }

      const payload = {
        id_sesi: document.getElementById('ej-id-sesi').value,
        tanggal: document.getElementById('ej-tanggal').value,
        mata_pelajaran: document.getElementById('ej-mapel').value,
        jam_pelajaran: document.getElementById('ej-jam').value,
        topik_jurnal: document.getElementById('ej-topik').value,
		catatan: document.getElementById('ej-catatan').value,
        data_absen: dataAbsenArray
      };

      try {
        const res = await callAPI('updateJurnalMapel', payload);
        Swal.fire({ icon: 'success', title: 'Berhasil', text: res.message, timer: 1500, showConfirmButton: false });
        
        bootstrap.Modal.getInstance(document.getElementById('modalEditJurnal')).hide();
        
        if (dataTableJurnalInstance) dataTableJurnalInstance.destroy();
        document.getElementById('tbody-riwayat-jurnal').innerHTML = '';
        loadRiwayatJurnal();
        
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = oriText;
      }
    });
  }
});

/* Fungsi Hapus Jurnal */
function hapusJurnal(idSesi) {
  Swal.fire({
    title: 'Hapus Jurnal?',
    text: 'Data jurnal dan presensi kelas ini akan dihapus permanen.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'Ya, Hapus!',
    cancelButtonText: 'Batal'
  }).then(async (result) => {
    if (result.isConfirmed) {
      Swal.fire({ title: 'Menghapus...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
      try {
        const res = await callAPI('hapusJurnalMapel', { idSesi: idSesi });
        Swal.fire({ icon: 'success', title: 'Terhapus', text: res.message, timer: 1500, showConfirmButton: false });
        
        if (dataTableJurnalInstance) dataTableJurnalInstance.destroy();
        document.getElementById('tbody-riwayat-jurnal').innerHTML = '';
        loadRiwayatJurnal();
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      }
    }
  });
}

/* ==========================================
   FUNGSI CETAK JURNAL MENGAJAR
   ========================================== */
async function cetakJurnalMengajar() {
  if (!window.riwayatJurnal || window.riwayatJurnal.length === 0) {
    Swal.fire('Kosong', 'Tidak ada riwayat jurnal untuk dicetak.', 'warning');
    return;
  }
  
  let dataCetak = [...window.riwayatJurnal];
  const filterBulan = document.getElementById('filter-bulan-jurnal').value;

  if (!window.identitasSekolah) {
    Swal.fire({ title: 'Menyiapkan Dokumen...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
    try {
      window.identitasSekolah = await callAPI('getIdentitasSekolah');
      Swal.close();
    } catch (e) {
      Swal.fire('Error', 'Gagal memuat identitas sekolah.', 'error');
      return;
    }
  }
  const idSekolah = window.identitasSekolah;
  const namaGuru = window.riwayatJurnal[0].nama_guru; 
  const nipGuru = window.riwayatJurnal[0].nip_guru;

  dataCetak.sort(function(a, b) {
    if (a.tanggal === b.tanggal) {
      let jamA = parseInt(a.jam.match(/\d+/)) || 0;
      let jamB = parseInt(b.jam.match(/\d+/)) || 0;
      return jamA - jamB;
    }
    return new Date(a.tanggal) - new Date(b.tanggal); 
  });
  
  const namaBulanIndo = new Date(filterBulan + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const printWindow = window.open('', '', 'height=800,width=1000');
  
  let htmlPrint = '<html><head><title>Jurnal Mengajar - ' + namaGuru + '</title>';
  htmlPrint += '<style>';
  htmlPrint += 'body { font-family: "Times New Roman", Times, serif; margin: 20px; color: #000; }';
  
  htmlPrint += '.kop-surat { display: flex; align-items: center; justify-content: space-between; border-bottom: 4px solid #000; padding-bottom: 10px; margin-bottom: 20px; }';
  htmlPrint += '.kop-logo { width: 90px; height: 90px; object-fit: contain; }';
  htmlPrint += '.kop-teks { text-align: center; flex-grow: 1; line-height: 1.2; }';
  htmlPrint += '.kop-teks h3 { margin: 0; font-size: 16px; font-weight: normal; }';
  htmlPrint += '.kop-teks h4 { margin: 0; font-size: 18px; font-weight: bold; }';
  htmlPrint += '.kop-teks h2 { margin: 5px 0; font-size: 24px; font-weight: bold; text-transform: uppercase; }';
  htmlPrint += '.kop-teks p { margin: 0; font-size: 12px; }';
  
  htmlPrint += '.judul-laporan { text-align: center; font-size: 16px; font-weight: bold; margin-bottom: 15px; text-decoration: underline; text-transform: uppercase; }';
  htmlPrint += '.info-laporan { margin-bottom: 15px; font-size: 12px; }';
  
  htmlPrint += 'table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 30px; }';
  htmlPrint += 'th, td { border: 1px solid #000; padding: 8px; text-align: left; vertical-align: top; }';
  htmlPrint += 'th { background-color: #f2f2f2; -webkit-print-color-adjust: exact; print-color-adjust: exact; text-align: center; }';
  htmlPrint += '.text-center { text-align: center; }';
  
  htmlPrint += '.ttd-container { display: flex; justify-content: space-between; margin-top: 40px; font-size: 12px; }';
  htmlPrint += '.ttd-box { text-align: center; width: 250px; }';
  htmlPrint += '.ttd-nama { font-weight: bold; text-decoration: underline; margin-top: 70px; margin-bottom: 5px; }';
  htmlPrint += '</style></head><body>';

  htmlPrint += generateKopSuratHTML(idSekolah);

  htmlPrint += '<div class="judul-laporan">JURNAL MENGAJAR GURU</div>';
  htmlPrint += '<div class="info-laporan">';
  htmlPrint += '<strong>Nama Guru:</strong> ' + namaGuru + '<br>';
  htmlPrint += '<strong>Bulan:</strong> ' + namaBulanIndo + '<br>';
  htmlPrint += '<strong>Dicetak Pada:</strong> ' + new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  htmlPrint += '</div>';

  htmlPrint += '<table><thead>';
  htmlPrint += '<tr><th width="5%">No</th><th width="15%">Hari, Tanggal</th><th width="10%">Kelas</th><th width="15%">Mapel (Jam)</th><th width="35%">Topik / Materi Pembelajaran</th><th width="20%">Absensi Siswa</th></tr>';
  htmlPrint += '</thead><tbody>';

  for (let i = 0; i < dataCetak.length; i++) {
    let r = dataCetak[i];
    
    let d = new Date(r.tanggal);
    let hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][d.getDay()];
    let tglIndo = hari + ', ' + ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + d.getFullYear();

    let rekapAbsen = "";
    try {
      let absenArr = JSON.parse(r.absen_json);
      let sakit = 0, izin = 0, alpa = 0;
      
      for(let a=0; a<absenArr.length; a++) {
        if(absenArr[a].status === 'Sakit') sakit++;
        else if(absenArr[a].status === 'Izin') izin++;
        else if(absenArr[a].status === 'Alpa') alpa++;
      }
      
      if(sakit === 0 && izin === 0 && alpa === 0) {
        rekapAbsen = "Nihil (Hadir Semua)";
      } else {
        if(sakit > 0) rekapAbsen += "S:" + sakit + " ";
        if(izin > 0) rekapAbsen += "I:" + izin + " ";
        if(alpa > 0) rekapAbsen += "A:" + alpa;
      }
    } catch(e) {
      rekapAbsen = "-";
    }

    htmlPrint += '<tr>';
    htmlPrint += '<td class="text-center">' + (i + 1) + '</td>';
    htmlPrint += '<td>' + tglIndo + '</td>';
    htmlPrint += '<td class="text-center">' + r.kelas + '</td>';
    htmlPrint += '<td><strong>' + r.mapel + '</strong><br>Jam ke: ' + r.jam + '</td>';
    htmlPrint += '<td>' + r.topik.replace(/\n/g, '<br>') + '</td>'; 
    htmlPrint += '<td>' + rekapAbsen + '</td>';
    htmlPrint += '</tr>';
  }

  htmlPrint += '</tbody></table>';
  
  htmlPrint += '</tbody></table>';
  htmlPrint += '<div class="ttd-container">';
  htmlPrint += '<div class="ttd-box">Mengetahui,<br>Kepala Sekolah<br><div class="ttd-nama">' + idSekolah.nama_kepsek + '</div>NIP ' + idSekolah.nip_kepsek + '</div>';
  htmlPrint += '<div class="ttd-box">Guru Mata Pelajaran<br><br><div class="ttd-nama">' + namaGuru + '</div>NIP ' + nipGuru + '</div>';
  htmlPrint += '</div>';

  htmlPrint += '<script>setTimeout(function() { window.print(); window.close(); }, 1000);</script>';
  htmlPrint += '</body></html>';

  printWindow.document.write(htmlPrint);
  printWindow.document.close();
  printWindow.focus();
}

/* Fungsi mereset tabel jika tanggal diubah */
function resetTabelSiswa() {
  document.getElementById('j-kelas').value = "";
  document.getElementById('tbody-absen-mapel').innerHTML = '<tr><td colspan="3" class="text-center text-muted py-5"><i class="fa-solid fa-arrow-left me-2"></i>Silakan pilih kelas terlebih dahulu.</td></tr>';
  document.getElementById('badge-jumlah-siswa').innerText = '0 Siswa';
  document.getElementById('btn-simpan-jurnal').disabled = true;
}

async function loadSiswaUntukAbsen(namaKelas) {
  const tbody = document.getElementById('tbody-absen-mapel');
  const btnSimpan = document.getElementById('btn-simpan-jurnal');
  const badgeJumlah = document.getElementById('badge-jumlah-siswa');
  const tglDipilih = document.getElementById('j-tanggal').value;
  
  tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Memuat data siswa...</td></tr>';
  btnSimpan.disabled = true;

  try {
    const dataSiswa = await callAPI('getSiswaByKelas', { namaKelas: namaKelas, tanggal: tglDipilih });
    
    badgeJumlah.innerText = dataSiswa.length + ' Siswa';

    if (dataSiswa.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-4">Tidak ada siswa aktif di kelas ini.</td></tr>';
      return;
    }

    let rowsHtml = '';
    for (let i = 0; i < dataSiswa.length; i++) {
      let s = dataSiswa[i];
      let statusDef = s.status_default; 
      
      rowsHtml += '<tr>';
      rowsHtml += '<td>' + (i + 1) + '</td>';
      rowsHtml += '<td><div class="fw-bold">' + s.nama_lengkap + '</div><small class="text-muted">' + s.nis + '</small></td>';
      rowsHtml += '<td class="text-center">';
      rowsHtml += '<div class="btn-group shadow-sm" role="group">';
      
      let chkH = statusDef === 'Hadir' ? 'checked' : '';
      let chkS = statusDef === 'Sakit' ? 'checked' : '';
      let chkI = statusDef === 'Izin' ? 'checked' : '';
      let chkA = statusDef === 'Alpa' ? 'checked' : '';
      
      rowsHtml += '<input type="radio" class="btn-check radio-absen" name="absen_' + s.nis + '" id="h_' + s.nis + '" value="Hadir" data-nis="' + s.nis + '" ' + chkH + '>';
      rowsHtml += '<label class="btn btn-outline-success btn-sm px-3" for="h_' + s.nis + '">H</label>';
      
      rowsHtml += '<input type="radio" class="btn-check radio-absen" name="absen_' + s.nis + '" id="s_' + s.nis + '" value="Sakit" data-nis="' + s.nis + '" ' + chkS + '>';
      rowsHtml += '<label class="btn btn-outline-warning btn-sm px-3" for="s_' + s.nis + '">S</label>';
      
      rowsHtml += '<input type="radio" class="btn-check radio-absen" name="absen_' + s.nis + '" id="i_' + s.nis + '" value="Izin" data-nis="' + s.nis + '" ' + chkI + '>';
      rowsHtml += '<label class="btn btn-outline-info btn-sm px-3" for="i_' + s.nis + '">I</label>';
      
      rowsHtml += '<input type="radio" class="btn-check radio-absen" name="absen_' + s.nis + '" id="a_' + s.nis + '" value="Alpa" data-nis="' + s.nis + '" ' + chkA + '>';
      rowsHtml += '<label class="btn btn-outline-danger btn-sm px-3" for="a_' + s.nis + '">A</label>';
      
      rowsHtml += '</div></td></tr>';
    }

    tbody.innerHTML = rowsHtml;
    btnSimpan.disabled = false; 
    btnSimpan.innerHTML = '<i class="fa-solid fa-save me-2"></i>Simpan Jurnal & Presensi';

  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-4">Gagal memuat data: ' + error.message + '</td></tr>';
  }
}

/* Fungsi mengeksekusi penyimpanan ke Backend */
async function prosesSimpanJurnal(e) {
  e.preventDefault();
  
  const btn = document.getElementById('btn-simpan-jurnal');
  const oriText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Menyimpan...';

  const radioTerpilih = document.querySelectorAll('.radio-absen:checked');
  let dataAbsenArray = [];
  
  for (let i = 0; i < radioTerpilih.length; i++) {
    dataAbsenArray.push({
      nis: radioTerpilih[i].getAttribute('data-nis'),
      status: radioTerpilih[i].value
    });
  }

  const payload = {
    tanggal: document.getElementById('j-tanggal').value,
    rombel_kelas: document.getElementById('j-kelas').value,
    mata_pelajaran: document.getElementById('j-mapel').value,
    jam_pelajaran: document.getElementById('j-jam').value,
    topik_jurnal: document.getElementById('j-topik').value,
    data_absen: dataAbsenArray 
  };

  try {
    const res = await callAPI('simpanJurnalPresensiMapel', payload);
    Swal.fire({ icon: 'success', title: 'Tersimpan!', text: res.message, timer: 2000, showConfirmButton: false });
    
    document.getElementById('form-jurnal').reset();
    document.getElementById('tbody-absen-mapel').innerHTML = '<tr><td colspan="3" class="text-center text-muted py-5"><i class="fa-solid fa-check-circle text-success fa-2x mb-2 d-block"></i>Data berhasil disimpan. Silakan pilih kelas lain.</td></tr>';
    document.getElementById('badge-jumlah-siswa').innerText = '0 Siswa';
    
  } catch (error) {
    Swal.fire('Gagal Menyimpan', error.message, 'error');
  } finally {
    btn.innerHTML = oriText;
  }
}

/* ==========================================
   13. MODUL INTERVENSI WALI KELAS
   ========================================== */

async function renderIntervensiWali() {
  const userRole = localStorage.getItem('sis_role');
  
  UI.contentView.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted">Menyiapkan antarmuka...</p></div>';
  
  try {
    if (!window.allSiswa) {
      window.allSiswa = await callAPI('getSiswaData');
    }
    
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    let html = '<div class="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-3 fade-in">';
	html += '  <div>';
	html += '    <h4 class="fw-bold mb-0">Intervensi Kehadiran</h4>';
	html += '  </div>';
	html += '  <div class="mt-1 mt-md-0">';
	html += '    <span class="text-muted small" id="label-kelas-intervensi">Memuat...</span>';
	html += '  </div>';
	if (userRole === 'Guru' && localStorage.getItem('sis_is_wali')==='Ya') {
      html += '<button class="btn btn-danger btn-sm shadow-sm" onclick="eksekusiEmailMassal()"><i class="fa-solid fa-envelopes-bulk me-1"></i> Kirim Email Massal</button>';
    }
	html += '</div>';

    html += '<div class="row mb-3 fade-in">';
    
    html += '<div class="col-md-3 mb-2">';
    html += '<label class="form-label small fw-bold text-secondary mb-1">Pilih Tanggal</label>';
    html += '<input type="date" id="int-filter-tanggal" class="form-control border-0 shadow-sm" value="' + todayStr + '" onchange="triggerLoadIntervensi()">';
    html += '</div>';

    if (userRole === 'Admin' || userRole === 'Kepsek') {
      const daftarKelas = await callAPI('getDaftarKelasDistinct');
      html += '<div class="col-md-4 mb-2">';
      html += '<label class="form-label small fw-bold text-secondary mb-1">Pilih Kelas</label>';
      html += '<select id="admin-pilih-kelas" class="form-select border-0 shadow-sm" onchange="triggerLoadIntervensi()">';
      html += '<option value="" disabled selected>-- Pilih Kelas --</option>';
      for(let k = 0; k < daftarKelas.length; k++) {
        html += '<option value="' + daftarKelas[k] + '">' + daftarKelas[k] + '</option>';
      }
      html += '</select></div>';
    }
    
    html += '</div>';

    html += '<div class="card shadow-sm border-0 fade-in">';
    html += '<div class="card-body p-3 table-responsive">';
    html += '<table id="tabel-intervensi" class="table table-hover align-middle mb-0">';
    html += '<thead class="table-light">';
    html += '<tr><th>No</th><th>Nama Siswa</th><th>Waktu Masuk</th><th>Waktu Pulang</th><th>Status</th><th>Aksi</th></tr></thead>';
    html += '<tbody id="tbody-intervensi">';
    html += '<tr><td colspan="6" class="text-center text-muted py-5">Silakan tunggu...</td></tr>';
    html += '</tbody></table></div></div>';

    UI.contentView.innerHTML = html;

    triggerLoadIntervensi();

  } catch (error) {
    Swal.fire('Error', error.message, 'error');
  }
}

function triggerLoadIntervensi() {
  const userRole = localStorage.getItem('sis_role');
  
  const tgl = document.getElementById('int-filter-tanggal').value;
  let kls = 'AUTO';
  
  if (userRole === 'Admin' || userRole === 'Kepsek') {
    const elKelas = document.getElementById('admin-pilih-kelas');
    if (!elKelas || elKelas.value === "") {
      document.getElementById('label-kelas-intervensi').innerHTML = 'Pilih kelas pada menu di bawah';
      document.getElementById('tbody-intervensi').innerHTML = '<tr><td colspan="6" class="text-center text-muted py-5"><i class="fa-solid fa-arrow-up me-2"></i>Admin: Silakan pilih kelas terlebih dahulu.</td></tr>';
      return;
    }
    kls = elKelas.value;
  }
  
  loadDataIntervensi(kls, tgl);
}

async function loadDataIntervensi(targetKelas, targetTanggal) {
  const tbody = document.getElementById('tbody-intervensi');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Mengambil data presensi...</td></tr>';

  try {
    const payload = { targetKelas: targetKelas, tanggal: targetTanggal };
    const response = await callAPI('getPresensiKelasHariIni', payload);
    
    const d = new Date(response.tanggal);
    const tglIndo = ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + d.getFullYear();
    
    document.getElementById('label-kelas-intervensi').innerHTML = 'Kelas: <strong>' + response.kelas_wali + '</strong> | Tanggal: <strong>' + tglIndo + '</strong>';
    window.presensiKelasHariIni = response.data_presensi;

    let tableRows = '';
    if (!response.data_presensi || response.data_presensi.length === 0) {
      tableRows = '<tr><td colspan="6" class="text-center text-muted py-4">Tidak ada data siswa di kelas ini.</td></tr>';
    } else {
      for (let i = 0; i < response.data_presensi.length; i++) {
        let p = response.data_presensi[i];
        
        let badgeColor = 'bg-danger';
        if (p.status_kehadiran === 'Hadir' || p.status_kehadiran === 'Terlambat') badgeColor = 'bg-success';
        else if (p.status_kehadiran === 'Sakit') badgeColor = 'bg-warning text-dark';
        else if (p.status_kehadiran === 'Izin') badgeColor = 'bg-info text-dark';

        let tandaIntervensi = p.intervensi_wali === 'Ya' ? '<br><small class="text-primary"><i class="fa-solid fa-check-circle me-1"></i>Diubah Wali</small>' : '';

        tableRows += '<tr>';
        tableRows += '<td>' + (i + 1) + '</td>';
        tableRows += '<td><div class="fw-bold">' + p.nama_lengkap + '</div><small class="text-muted">' + p.nis + '</small></td>';
        tableRows += '<td><span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i>' + p.waktu_masuk + '</span></td>';
        tableRows += '<td><span class="badge bg-light text-dark border"><i class="fa-regular fa-clock me-1"></i>' + p.waktu_pulang + '</span></td>';
        tableRows += '<td><span class="badge ' + badgeColor + '">' + p.status_kehadiran + '</span>' + tandaIntervensi + '</td>';
        tableRows += '<td><div class="btn-group font-monospace">';
        tableRows += '<button class="btn btn-sm btn-primary shadow-sm" title="Ubah Status" onclick="bukaModalIntervensi(\'' + p.nis + '\')"><i class="fa-solid fa-pen-to-square"></i></button>';
        
        let dataLengkap = window.allSiswa.find(function(s) { return s.nis.toString() === p.nis.toString(); });
        let noHp = dataLengkap ? dataLengkap.no_hp_wali : "";
        
        tableRows += '<button class="btn btn-sm btn-success shadow-sm" title="Hubungi Wali" onclick="bukaModalNotif(\'' + p.nis + '\', \'' + p.nama_lengkap + '\', \'' + p.status_kehadiran + '\', \'' + noHp + '\')"><i class="fa-brands fa-whatsapp"></i></button>';
        tableRows += '</div></td>';
        tableRows += '</tr>';
      }
    }

    tbody.innerHTML = tableRows;

  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">' + error.message + '</td></tr>';
  }
}

function bukaModalIntervensi(nisSiswa) {
  const dataSiswa = window.presensiKelasHariIni.find(function(s) { return s.nis.toString() === nisSiswa.toString(); });
  if(!dataSiswa) return;

  document.getElementById('int-nis').value = dataSiswa.nis;
  document.getElementById('int-nama-siswa').innerText = dataSiswa.nama_lengkap;
  
  const statusSelect = document.getElementById('int-status');
  if (dataSiswa.status_kehadiran === 'Sakit' || dataSiswa.status_kehadiran === 'Izin' || dataSiswa.status_kehadiran === 'Alpa') {
    statusSelect.value = dataSiswa.status_kehadiran;
  } else {
    statusSelect.value = 'Hadir';
  }

  document.getElementById('int-keterangan').value = dataSiswa.keterangan_wali || '';

  new bootstrap.Modal(document.getElementById('modalIntervensi')).show();
}

document.addEventListener("DOMContentLoaded", function() {
  const formIntervensi = document.getElementById('form-intervensi');
  if(formIntervensi) {
    formIntervensi.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('btn-simpan-intervensi');
      const oriText = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = 'Menyimpan...';

      const payload = {
        nis: document.getElementById('int-nis').value,
        status_baru: document.getElementById('int-status').value,
        keterangan: document.getElementById('int-keterangan').value
      };

      try {
        const res = await callAPI('simpanIntervensiWali', payload);
        Swal.fire({ icon: 'success', title: 'Berhasil', text: res.message, timer: 1500, showConfirmButton: false });
        
        bootstrap.Modal.getInstance(document.getElementById('modalIntervensi')).hide();
        formIntervensi.reset();
        
        renderIntervensiWali();
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = oriText;
      }
    });
  }
});

/* ==========================================
   FITUR NOTIFIKASI WALI MURID
   ========================================== */

function bukaModalNotif(nis, nama, status, noHp) {
  document.getElementById('notif-nis').value = nis;
  document.getElementById('notif-nama-siswa').innerText = nama;
  document.getElementById('notif-status').value = status;
  document.getElementById('notif-nohp').value = noHp;
  
  const tgl = document.getElementById('int-filter-tanggal').value;
  document.getElementById('notif-tanggal').value = tgl;

  new bootstrap.Modal(document.getElementById('modalHubungiWali')).show();
}

function kirimNotifWA() {
  let noHp = document.getElementById('notif-nohp').value;
  
  noHp = noHp.replace(/['\s-]/g, '');
  
  if (!noHp || noHp === "") {
    Swal.fire('Gagal', 'Nomor HP Wali Murid belum didaftarkan untuk siswa ini.', 'error');
    return;
  }

  if (noHp.startsWith('0')) {
    noHp = '62' + noHp.substring(1);
  }

  const nama = document.getElementById('notif-nama-siswa').innerText;
  const status = document.getElementById('notif-status').value;
  const tgl = document.getElementById('notif-tanggal').value;
  
  const d = new Date(tgl);
  const tglIndo = ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + d.getFullYear();

  let pesan = "Yth. Bapak/Ibu Wali Murid,\n\n";
  pesan += "Kami dari pihak sekolah menginformasikan bahwa putra/putri Anda:\n";
  pesan += "Nama: *" + nama + "*\n";
  pesan += "Tanggal: *" + tglIndo + "*\n";
  pesan += "Status Kehadiran: *" + status.toUpperCase() + "*\n\n";
  
  if (status === 'Alpa') {
    pesan += "Mohon konfirmasinya terkait ketidakhadiran ananda pada hari ini. Terima kasih.";
  } else {
    pesan += "Terima kasih atas perhatiannya.";
  }

  const waUrl = "https://wa.me/" + noHp + "?text=" + encodeURIComponent(pesan);
  window.open(waUrl, '_blank');
  
  bootstrap.Modal.getInstance(document.getElementById('modalHubungiWali')).hide();
}

async function kirimNotifEmail() {
  const nis = document.getElementById('notif-nis').value;
  const status = document.getElementById('notif-status').value;
  const tgl = document.getElementById('notif-tanggal').value;
  
  const btn = document.getElementById('btn-notif-email');
  const oriText = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Mengirim...';

  try {
    const payload = { nis: nis, status: status, tanggal: tgl, keterangan: "" };
    const res = await callAPI('kirimEmailNotifikasi', payload);
    
    Swal.fire({ icon: 'success', title: 'Terkirim!', text: res.message, timer: 2000, showConfirmButton: false });
    bootstrap.Modal.getInstance(document.getElementById('modalHubungiWali')).hide();
  } catch (err) {
    Swal.fire('Gagal', err.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = oriText;
  }
}

/* Fungsi Eksekusi Kirim Email Massal */
function eksekusiEmailMassal() {
  const tgl = document.getElementById('int-filter-tanggal').value;
  
  const d = new Date(tgl);
  const tglIndo = ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + d.getFullYear();

  Swal.fire({
    title: 'Kirim Email Massal?',
    html: 'Sistem akan mengirimkan laporan kehadiran tanggal <strong>' + tglIndo + '</strong> ke seluruh email orang tua di kelas ini secara otomatis.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'Ya, Kirim Sekarang',
    cancelButtonText: 'Batal'
  }).then(async (result) => {
    if (result.isConfirmed) {
      
      /* Tampilkan loading karena proses kirim 30 email butuh waktu beberapa detik */
      Swal.fire({ 
        title: 'Mengirim Email...', 
        html: 'Mohon tunggu, proses ini memakan waktu beberapa detik.<br><br><div class="spinner-border text-danger"></div>', 
        allowOutsideClick: false, 
        showConfirmButton: false 
      });
      
      try {
        const res = await callAPI('kirimEmailMassalWaliKelas', { tanggal: tgl });
        Swal.fire({ icon: 'success', title: 'Selesai!', text: res.message });
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      }
    }
  });
}

/* ==========================================
   14. MODUL MANAJEMEN PENGGUNA (ADMIN)
   ========================================== */

let dataTableUserInstance = null;

async function renderManajemenUser() {
  UI.contentView.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-info"></div><p class="mt-2 text-muted">Memuat data pengguna...</p></div>';

  try {
    const [dataUsers, dataGuru] = await Promise.all([
      callAPI('getUserData'),
      callAPI('getGuruData')
    ]);
    
    window.dataUsersAktif = dataUsers;
	
	const dataKalender = await callAPI('getPengaturanKalender');
    document.getElementById('u-password').value = dataKalender.password_default;

    let opsiGuruHtml = '<option value="" disabled selected>-- Pilih Guru --</option>';
    for (let g = 0; g < dataGuru.length; g++) {
      opsiGuruHtml += '<option value="' + dataGuru[g].id_guru + '">' + dataGuru[g].nama_guru + '</option>';
    }
    const selectRelasi = document.getElementById('u-relasi');
    if (selectRelasi) selectRelasi.innerHTML = opsiGuruHtml;

    let html = '<div class="d-flex justify-content-between align-items-center mb-3 fade-in">';
    html += '<h4 class="fw-bold mb-0">Manajemen Pengguna</h4>';
    html += '<button class="btn btn-info text-white fw-bold btn-sm shadow-sm" data-bs-toggle="modal" data-bs-target="#modalTambahUser"><i class="fa-solid fa-user-plus me-1"></i> Buat Akun Baru</button>';
    html += '</div>';

    html += '<div class="card shadow-sm border-0 fade-in"><div class="card-body p-3 table-responsive">';
    html += '<table id="tabel-user" class="table table-hover align-middle mb-0"><thead class="table-light"><tr><th>No</th><th>Username</th><th>Hak Akses (Role)</th><th>Identitas Tertaut</th><th>Aksi</th></tr></thead><tbody>';

    let tableRows = '';
    if (!dataUsers || dataUsers.length === 0) {
      tableRows = '<tr><td colspan="5" class="text-center text-muted py-4">Belum ada data pengguna.</td></tr>';
    } else {
      for (let i = 0; i < dataUsers.length; i++) {
        let u = dataUsers[i];
        
        let badgeColor = 'bg-secondary';
        if (u.role === 'Admin') badgeColor = 'bg-danger';
        else if (u.role === 'Kepsek') badgeColor = 'bg-primary';
        else if (u.role === 'Wali_Kelas') badgeColor = 'bg-info text-dark';
        else if (u.role === 'Guru') badgeColor = 'bg-success';

        let btnAksi = '';
		if(localStorage.getItem('sis_role')==='Admin' && u.username.toLowerCase() === 'admin'){
			if(localStorage.getItem('sis_relasi_id')==='ADM-001'){
				btnAksi = '<button class="btn btn-sm btn-outline-warning text-dark me-1" onclick="bukaModalEditUser(\'' + u.id_user + '\')"><i class="fa-solid fa-pen"></i></button>';
			}
			else{
				btnAksi = '<span class="badge bg-light text-muted border"><i class="fa-solid fa-lock me-1"></i>Sistem</span>';
			}
		}
		else{
			btnAksi = '<button class="btn btn-sm btn-outline-warning text-dark me-1" onclick="bukaModalEditUser(\'' + u.id_user + '\')"><i class="fa-solid fa-pen"></i></button>';
			btnAksi += '<button class="btn btn-sm btn-outline-danger" onclick="hapusUser(\'' + u.id_user + '\', \'' + u.username + '\')"><i class="fa-solid fa-trash"></i></button>';
		}

        tableRows += '<tr>';
        tableRows += '<td>' + (i + 1) + '</td>';
        tableRows += '<td><strong>' + u.username + '</strong></td>';
        tableRows += '<td><span class="badge ' + badgeColor + '">' + u.role + '</span></td>';
        tableRows += '<td>' + u.nama_relasi + '</td>';
        tableRows += '<td>' + btnAksi + '</td>';
        tableRows += '</tr>';
      }
    }

    html += tableRows;
    html += '</tbody></table></div></div>';

    UI.contentView.innerHTML = html;

    if (dataTableUserInstance) {
      dataTableUserInstance.destroy();
    }
    
    const tableElement = document.getElementById('tabel-user');
    if (tableElement && dataUsers.length > 0) {
      dataTableUserInstance = new simpleDatatables.DataTable(tableElement, {
        searchable: true,
        fixedHeight: true,
        perPage: 10,
        labels: {
          placeholder: "Cari username atau nama...",
          perPage: "data per halaman",
          noRows: "Tidak ada data ditemukan",
          info: "Menampilkan {start} sampai {end} dari {rows} data"
        }
      });
    }

  } catch (error) {
    Swal.fire('Error', error.message, 'error');
  }
}

/* Event Listener untuk Dropdown Role di Form Tambah & Edit */
document.addEventListener("DOMContentLoaded", function() {
  
  /* --- LOGIKA FORM TAMBAH USER --- */
  const roleSelect = document.getElementById('u-role');
  const relasiContainer = document.getElementById('u-relasi-container');
  const relasiSelect = document.getElementById('u-relasi');

  if (roleSelect) {
    roleSelect.addEventListener('change', function() {
      /* Kepsek dan Guru WAJIB ditautkan ke data Guru */
      if (this.value === 'Guru' || this.value === 'Kepsek') {
        relasiContainer.style.display = 'block';
        relasiSelect.required = true;
      } else {
        relasiContainer.style.display = 'none';
        relasiSelect.required = false;
        relasiSelect.value = '';
      }
    });
  }

  const formTambahUser = document.getElementById('form-tambah-user');
  if (formTambahUser) {
    formTambahUser.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('btn-simpan-user');
      const oriText = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = 'Memproses...';

      const roleVal = document.getElementById('u-role').value;
      const payload = {
        username: document.getElementById('u-username').value.trim(),
        password: document.getElementById('u-password').value,
		email_google: document.getElementById('u-email-google').value.trim(),
        role: roleVal,
        relasi_id: (roleVal === 'Guru' || roleVal === 'Kepsek') ? document.getElementById('u-relasi').value : 'ADM-001' 
      };

      try {
        const res = await callAPI('tambahUserBaru', payload);
        Swal.fire({ icon: 'success', title: 'Berhasil', text: res.message, timer: 1500, showConfirmButton: false });
        bootstrap.Modal.getInstance(document.getElementById('modalTambahUser')).hide();
        formTambahUser.reset();
        relasiContainer.style.display = 'none';
        renderManajemenUser(); 
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = oriText;
      }
    });
  }

  /* --- LOGIKA FORM EDIT USER --- */
  const euRoleSelect = document.getElementById('eu-role');
  const euRelasiContainer = document.getElementById('eu-relasi-container');
  const euRelasiSelect = document.getElementById('eu-relasi');

  if (euRoleSelect) {
    euRoleSelect.addEventListener('change', function() {
      if (this.value === 'Guru' || this.value === 'Kepsek') {
        euRelasiContainer.style.display = 'block';
        euRelasiSelect.required = true;
      } else {
        euRelasiContainer.style.display = 'none';
        euRelasiSelect.required = false;
        euRelasiSelect.value = '';
      }
    });
  }

  const formEditUser = document.getElementById('form-edit-user');
  if (formEditUser) {
    formEditUser.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('btn-update-user');
      const oriText = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = 'Menyimpan...';

      const elRole = document.getElementById('eu-role');
      const roleVal = elRole.disabled ? 'Admin' : elRole.value;;
      const payload = {
        id_user: document.getElementById('eu-id-user').value,
        role: roleVal,
        password: document.getElementById('eu-password').value,
		email_google: document.getElementById('eu-email-google').value.trim(),
        relasi_id: (roleVal === 'Guru' || roleVal === 'Kepsek') ? document.getElementById('eu-relasi').value : 'ADM-001'
      };

      try {
        const res = await callAPI('updateUser', payload);
        Swal.fire({ icon: 'success', title: 'Berhasil', text: res.message, timer: 1500, showConfirmButton: false });
        bootstrap.Modal.getInstance(document.getElementById('modalEditUser')).hide();
        renderManajemenUser();
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = oriText;
      }
    });
  }
  
  /* LOGIKA FORM UBAH PASSWORD SENDIRI */
  const formUbahPassword = document.getElementById('form-ubah-password');
  if (formUbahPassword) {
    formUbahPassword.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const passBaru = document.getElementById('up-password-baru').value;
      const passKonfirm = document.getElementById('up-password-konfirm').value;

      if (passBaru !== passKonfirm) {
        Swal.fire('Validasi Gagal', 'Konfirmasi password tidak cocok!', 'error');
        return;
      }

      const btn = document.getElementById('btn-simpan-password');
      const oriText = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = 'Menyimpan...';

      try {
        const res = await callAPI('ubahPasswordSendiri', { password_baru: passBaru });
        
        Swal.fire({ 
          icon: 'success', 
          title: 'Berhasil', 
          text: res.message,
          confirmButtonText: 'Login Ulang'
        }).then(() => {
          bootstrap.Modal.getInstance(document.getElementById('modalUbahPassword')).hide();
          formUbahPassword.reset();
          
		  localStorage.removeItem('sis_force_pass');
		  
          /* Hapus sesi lokal dan paksa ke halaman login */
          clearSession();
          showView('login');
        });
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = oriText;
      }
    });
  }
});

/* Fungsi Membuka Modal Edit User */
async function bukaModalEditUser(idUser) {
  const user = window.dataUsersAktif.find(function(u) { return u.id_user === idUser; });
  if(!user) return;

  document.getElementById('eu-id-user').value = user.id_user;
  document.getElementById('eu-username').value = user.username;
  document.getElementById('eu-role').value = user.role;
  document.getElementById('eu-email-google').value = user.email_google;
  document.getElementById('eu-password').value = '';

  const relasiContainer = document.getElementById('eu-relasi-container');
  const relasiSelect = document.getElementById('eu-relasi');

  /* Copy opsi guru dari form tambah */
  relasiSelect.innerHTML = document.getElementById('u-relasi').innerHTML;

  if (user.role === 'Guru' || user.role === 'Kepsek') {
    relasiContainer.style.display = 'block';
    relasiSelect.value = user.relasi_id;
  } else {
    relasiContainer.style.display = 'none';
  }

  /* Kunci dropdown role jika yang diedit adalah akun admin utama */
  if (user.username.toLowerCase() === 'admin') {
    document.getElementById('eu-role').disabled = true;
  } else {
    document.getElementById('eu-role').disabled = false;
  }

  new bootstrap.Modal(document.getElementById('modalEditUser')).show();
}

function hapusUser(idUser, username) {
  Swal.fire({
    title: 'Hapus Akun?',
    text: "Akun '" + username + "' akan dihapus permanen.",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'Ya, Hapus!'
  }).then(async (result) => {
    if (result.isConfirmed) {
      Swal.fire({ title: 'Menghapus...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
      try {
        const res = await callAPI('hapusUser', { idUser: idUser });
        Swal.fire({ icon: 'success', title: 'Terhapus', text: res.message, timer: 1500, showConfirmButton: false });
        renderManajemenUser();
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      }
    }
  });
}

/* ==========================================
   15. MODUL LAPORAN AKADEMIK
   ========================================== */

let dataTableLaporanInstance = null;

async function renderLaporanAkademik() {
  const userRole = localStorage.getItem('sis_role');
  const isWali = localStorage.getItem('sis_is_wali');
  
  UI.contentView.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted">Menyiapkan antarmuka laporan...</p></div>';

  try {
    const daftarKelas = await callAPI('getDaftarKelasDistinct');
    
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const firstDayStr = firstDay.getFullYear() + '-' + String(firstDay.getMonth() + 1).padStart(2, '0') + '-' + String(firstDay.getDate()).padStart(2, '0');

    let html = '<div class="d-flex justify-content-between align-items-center mb-3 fade-in">';
    html += '<h4 class="fw-bold mb-0">Laporan Rekapitulasi Presensi</h4>';
    html += '<button class="btn btn-success btn-sm shadow-sm" onclick="cetakLaporan()"><i class="fa-solid fa-print me-1"></i> Cetak Laporan</button>';
    html += '</div>';

    html += '<div class="card shadow-sm border-0 mb-4 fade-in"><div class="card-body bg-light">';
    html += '<div class="row align-items-end">';
    
    html += '<div class="col-md-3 mb-2">';
    html += '<label class="form-label small fw-bold text-secondary mb-1">Dari Tanggal</label>';
    html += '<input type="date" id="lap-tgl-mulai" class="form-control border-0 shadow-sm" value="' + firstDayStr + '">';
    html += '</div>';

    html += '<div class="col-md-3 mb-2">';
    html += '<label class="form-label small fw-bold text-secondary mb-1">Sampai Tanggal</label>';
    html += '<input type="date" id="lap-tgl-akhir" class="form-control border-0 shadow-sm" value="' + todayStr + '">';
    html += '</div>';
	
	html += '<div class="col-md-3 mb-2">';
    html += '<label class="form-label small fw-bold text-secondary mb-1">Pilih Periode</label>';
    html += generateDropdownPeriode('lap-periode', '');
    html += '</div>';

    html += '<div class="col-md-4 mb-2">';
    html += '<label class="form-label small fw-bold text-secondary mb-1">Pilih Kelas</label>';
    
    if (userRole === 'Guru' && isWali === 'Ya') {
      const resWali = await callAPI('getPresensiKelasHariIni', { targetKelas: 'AUTO', tanggal: todayStr });
      html += '<select id="lap-kelas" class="form-select border-0 shadow-sm" disabled>';
      html += '<option value="' + resWali.kelas_wali + '" selected>' + resWali.kelas_wali + '</option>';
      html += '</select></div>';
    } else {
      const daftarKelas = await callAPI('getDaftarKelasDistinct');
      html += '<select id="lap-kelas" class="form-select border-0 shadow-sm">';
      html += '<option value="SEMUA">Semua Kelas</option>';
      for(let k = 0; k < daftarKelas.length; k++) {
        html += '<option value="' + daftarKelas[k] + '">' + daftarKelas[k] + '</option>';
      }
      html += '</select></div>';
    }

    html += '<div class="col-md-2 mb-2">';
    html += '<button class="btn btn-primary w-100 fw-bold shadow-sm" onclick="loadDataLaporan()"><i class="fa-solid fa-magnifying-glass me-2"></i>Tampilkan</button>';
    html += '</div>';

    html += '<div class="card shadow-sm border-0 fade-in">';
    html += '<div class="card-body p-3 table-responsive">';
    html += '<table id="tabel-laporan" class="table table-hover table-bordered align-middle mb-0 text-center">';
    html += '<thead class="table-light align-middle">';
    html += '<tr>';
    html += '<th width="5%">No</th>';
    html += '<th class="text-start">Nama Siswa</th>';
    html += '<th>Kelas</th>';
    html += '<th class="text-success">Hadir</th>';
    html += '<th class="text-success">Terlambat</th>';
    html += '<th class="text-warning text-dark">Sakit</th>';
    html += '<th class="text-info text-dark">Izin</th>';
    html += '<th class="text-danger">Alpa</th>';
    html += '</tr>';
    html += '</thead><tbody id="tbody-laporan">';
    html += '<tr><td colspan="8" class="text-center text-muted py-5">Silakan klik tombol Tampilkan.</td></tr>';
    html += '</tbody></table></div></div>';

    html += '<div id="area-print-laporan" class="d-none"></div>';

    UI.contentView.innerHTML = html;

  } catch (error) {
    Swal.fire('Error', error.message, 'error');
  }
}

async function loadDataLaporan() {
  if (dataTableLaporanInstance) {
    dataTableLaporanInstance.destroy();
    dataTableLaporanInstance = null;
  }

  const tbody = document.getElementById('tbody-laporan');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="text-center py-5"><div class="spinner-border text-primary spinner-border-sm me-2"></div>Menghitung rekapitulasi...</td></tr>';

  const elPeriode = document.getElementById('lap-periode');
  const payload = {
    tglMulai: document.getElementById('lap-tgl-mulai').value,
    tglAkhir: document.getElementById('lap-tgl-akhir').value,
    targetKelas: document.getElementById('lap-kelas').value,
    periode: elPeriode ? elPeriode.value : localStorage.getItem('sis_periode_aktif')
  };

  try {
    const dataRekap = await callAPI('getRekapPresensi', payload);
    window.dataLaporanAktif = dataRekap;

    let tableRows = '';
    if (!dataRekap || dataRekap.length === 0) {
      tableRows = '<tr><td colspan="8" class="text-center text-muted py-4">Tidak ada data siswa.</td></tr>';
    } else {
      for (let i = 0; i < dataRekap.length; i++) {
        let r = dataRekap[i];
        tableRows += '<tr>';
        tableRows += '<td>' + (i + 1) + '</td>';
        tableRows += '<td class="text-start fw-bold">' + r.nama_lengkap + '<br><small class="text-muted fw-normal">' + r.nisn + '</small></td>';
        tableRows += '<td>' + r.kelas + '</td>';
        tableRows += '<td class="fw-bold text-success">' + r.hadir + '</td>';
        tableRows += '<td class="fw-bold text-success">' + r.terlambat + '</td>';
        tableRows += '<td class="fw-bold text-warning">' + r.sakit + '</td>';
        tableRows += '<td class="fw-bold text-info">' + r.izin + '</td>';
        tableRows += '<td class="fw-bold text-danger">' + r.alpa + '</td>';
        tableRows += '</tr>';
      }
    }

    tbody.innerHTML = tableRows;

    const tableElement = document.getElementById('tabel-laporan');
    if (tableElement && dataRekap.length > 0) {
      dataTableLaporanInstance = new simpleDatatables.DataTable(tableElement, {
        searchable: true, 
        fixedHeight: false,
        perPage: 10,
        labels: { 
          placeholder: "Cari nama siswa...", 
          perPage: "data per halaman", 
          noRows: "Tidak ada data", 
          info: "Menampilkan {start} sampai {end} dari {rows} data" 
        }
      });
    }

  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-4">' + error.message + '</td></tr>';
  }
}

/* ==========================================
   FUNGSI CETAK LAPORAN AKADEMIK
   ========================================== */
async function cetakLaporan() {
  if (!window.dataLaporanAktif || window.dataLaporanAktif.length === 0) {
    Swal.fire('Kosong', 'Silakan tampilkan data laporan terlebih dahulu.', 'warning');
    return;
  }

  if (!window.identitasSekolah) {
    Swal.fire({ title: 'Menyiapkan Dokumen...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
    try {
      window.identitasSekolah = await callAPI('getIdentitasSekolah');
      Swal.close();
    } catch (e) {
      Swal.fire('Error', 'Gagal memuat identitas sekolah.', 'error');
      return;
    }
  }
  const idSekolah = window.identitasSekolah;

  const tglMulai = document.getElementById('lap-tgl-mulai').value;
  const tglAkhir = document.getElementById('lap-tgl-akhir').value;
  const kelas = document.getElementById('lap-kelas').options[document.getElementById('lap-kelas').selectedIndex].text;

  const printWindow = window.open('', '', 'height=800,width=1000');
  
  let htmlPrint = '<html><head><title>Laporan Presensi - ' + kelas + '</title>';
  htmlPrint += '<style>';
  htmlPrint += 'body { font-family: "Times New Roman", Times, serif; margin: 20px; color: #000; }';
  
  htmlPrint += '.kop-surat { display: flex; align-items: center; justify-content: space-between; border-bottom: 4px solid #000; padding-bottom: 10px; margin-bottom: 20px; }';
  htmlPrint += '.kop-logo { width: 90px; height: 90px; object-fit: contain; }';
  htmlPrint += '.kop-teks { text-align: center; flex-grow: 1; line-height: 1.2; }';
  htmlPrint += '.kop-teks h3 { margin: 0; font-size: 16px; font-weight: normal; }';
  htmlPrint += '.kop-teks h4 { margin: 0; font-size: 18px; font-weight: bold; }';
  htmlPrint += '.kop-teks h2 { margin: 5px 0; font-size: 24px; font-weight: bold; text-transform: uppercase; }';
  htmlPrint += '.kop-teks p { margin: 0; font-size: 12px; }';
  
  htmlPrint += '.judul-laporan { text-align: center; font-size: 16px; font-weight: bold; margin-bottom: 15px; text-decoration: underline; }';
  htmlPrint += '.info-laporan { margin-bottom: 15px; font-size: 12px; }';
  
  htmlPrint += 'table { width: 100%; border-collapse: collapse; font-size: 12px; }';
  htmlPrint += 'th, td { border: 1px solid #000; padding: 6px; text-align: center; }';
  htmlPrint += 'th { background-color: #f2f2f2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }';
  htmlPrint += '.text-left { text-align: left; }';
  htmlPrint += '</style></head><body>';

  htmlPrint += generateKopSuratHTML(idSekolah);

  htmlPrint += '<div class="judul-laporan">REKAPITULASI PRESENSI SISWA</div>';
  htmlPrint += '<div class="info-laporan">';
  htmlPrint += '<strong>Kelas:</strong> ' + kelas + '<br>';
  htmlPrint += '<strong>Periode:</strong> ' + tglMulai + ' s/d ' + tglAkhir;
  htmlPrint += '</div>';

  htmlPrint += '<table><thead>';
  htmlPrint += '<tr><th rowspan="2">No</th><th rowspan="2" class="text-left">Nama Siswa</th><th rowspan="2">NISN</th><th colspan="5">Kehadiran</th></tr>';
  htmlPrint += '<tr><th>Hadir</th><th>Terlambat</th><th>Sakit</th><th>Izin</th><th>Alpa</th></tr>';
  htmlPrint += '</thead><tbody>';

  for (let i = 0; i < window.dataLaporanAktif.length; i++) {
    let r = window.dataLaporanAktif[i];
    htmlPrint += '<tr>';
    htmlPrint += '<td>' + (i + 1) + '</td>';
    htmlPrint += '<td class="text-left">' + r.nama_lengkap + '</td>';
    htmlPrint += '<td>' + r.nisn + '</td>';
    htmlPrint += '<td>' + r.hadir + '</td>';
    htmlPrint += '<td>' + r.terlambat + '</td>';
    htmlPrint += '<td>' + r.sakit + '</td>';
    htmlPrint += '<td>' + r.izin + '</td>';
    htmlPrint += '<td>' + r.alpa + '</td>';
    htmlPrint += '</tr>';
  }

  htmlPrint += '</tbody></table>';
  
  htmlPrint += '<script>setTimeout(function() { window.print(); window.close(); }, 1000);</script>';
  htmlPrint += '</body></html>';

  printWindow.document.write(htmlPrint);
  printWindow.document.close();
  printWindow.focus();
}

/* ==========================================
   16. MODUL MANAJEMEN DATABASE
   ========================================== */

function renderManajemenDatabase() {
  let html = '<div class="d-flex justify-content-between align-items-center mb-3 fade-in">';
  html += '<h4 class="fw-bold mb-0">Manajemen Database</h4>';
  html += '</div>';

  html += '<div class="row justify-content-center fade-in">';
  html += '<div class="col-md-8">';
  html += '<div class="card shadow-lg border-0" style="border-radius: 15px;">';
  html += '<div class="card-header bg-dark text-white text-center fw-bold py-3 border-0"><i class="fa-solid fa-database me-2"></i>Transisi Akademik & Kenaikan Kelas</div>';
  html += '<div class="card-body p-5 bg-light">';
  
  html += '<div class="alert alert-info border-0 shadow-sm mb-4">';
  html += '<h6 class="fw-bold"><i class="fa-solid fa-circle-info me-2"></i>Informasi Sistem (Partisi Waktu)</h6>';
  html += '<p class="small mb-0">Sistem menggunakan <strong>Partisi Berbasis Waktu</strong>. Data transaksi akan otomatis dipisahkan berdasarkan Tahun Ajaran dan Semester yang Anda pilih. Data lama tetap aman di partisinya masing-masing.</p>';
  html += '</div>';

  html += '<form id="form-transisi-akademik">';
  
  html += '<div class="mb-4">';
  html += '<label class="form-label fw-bold text-secondary">Pilih Jenis Transisi</label>';
  html += '<select id="ta-jenis" class="form-select border-0 py-3 shadow-sm fw-bold text-primary" required onchange="togglePeringatanTransisi(this.value)">';
  html += '<option value="" disabled selected>-- Pilih Tindakan --</option>';
  html += '<option value="SEMESTER">Hanya Ganti Semester (Ganti Partisi Saja)</option>';
  html += '<option value="TAHUN_AJARAN">Ganti Tahun Ajaran (Ganti Partisi + Kenaikan Kelas)</option>';
  html += '</select>';
  html += '</div>';

  html += '<div class="row mb-4">';
  html += '<div class="col-md-6">';
  html += '<label class="form-label small fw-bold text-secondary">Tahun Ajaran Baru (Tahun Awal)</label>';
  html += '<div class="input-group shadow-sm">';
  html += '<input type="number" id="ta-tahun" class="form-control border-0 py-2" placeholder="Contoh: 2026" required min="2020" max="2099">';
  html += '<span id="ta-tahun-next" class="input-group-text bg-white border-0 text-muted fw-bold">/ ...</span>';
  html += '</div>';
  html += '<div class="form-text small">Ketik tahun awalnya saja (misal: 2026).</div>';
  html += '</div>';
  html += '<div class="col-md-6">';
  html += '<label class="form-label small fw-bold text-secondary">Semester Baru</label>';
  html += '<select id="ta-semester" class="form-select border-0 py-2 shadow-sm" required>';
  html += '<option value="Ganjil">Ganjil</option>';
  html += '<option value="Genap">Genap</option>';
  html += '</select>';
  html += '</div>';
  html += '</div>';
  
  html += '<button type="submit" id="btn-eksekusi-transisi" class="btn btn-primary w-100 fw-bold py-3 shadow-sm rounded-pill"><i class="fa-solid fa-power-off me-2"></i>EKSEKUSI TRANSISI</button>';
  html += '</form>';

  html += '</div></div></div></div>';

  UI.contentView.innerHTML = html;
  
  const inputTahun = document.getElementById('ta-tahun');
  const spanTahunNext = document.getElementById('ta-tahun-next');
  
  if (inputTahun && spanTahunNext) {
    inputTahun.addEventListener('input', function() {
      const tahunAwal = parseInt(this.value);
      if (!isNaN(tahunAwal) && this.value.length === 4) {
        spanTahunNext.innerHTML = '/ <span class="text-primary">' + (tahunAwal + 1) + '</span>';
      } else {
        spanTahunNext.innerHTML = '/ ...';
      }
    });
  }

  document.getElementById('form-transisi-akademik').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const jenis = document.getElementById('ta-jenis').value;
    const tahunAwal = document.getElementById('ta-tahun').value;
    const semester = document.getElementById('ta-semester').value;

    let pesanPeringatan = "Sistem akan mengalihkan partisi database ke <b>" + semester + " " + tahunAwal + "/" + (parseInt(tahunAwal)+1) + "</b>.";
    if (jenis === 'TAHUN_AJARAN') {
      pesanPeringatan += "<br><br><span class='text-danger'><b>PERINGATAN:</b> Siswa juga akan dinaikkan kelasnya secara otomatis!</span>";
    }

    Swal.fire({
      title: 'Lanjutkan Eksekusi?',
      html: pesanPeringatan,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#0d6efd',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Ya, Eksekusi Sekarang',
      cancelButtonText: 'Batal'
    }).then(async (result) => {
      if (result.isConfirmed) {
        const btn = document.getElementById('btn-eksekusi-transisi');
        btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Memproses Database...';
        
        try {
          const payload = { jenisTransisi: jenis, tahunAwal: tahunAwal, semesterBaru: semester };
          const res = await callAPI('prosesTransisiAkademik', payload);
          
          Swal.fire({ icon: 'success', title: 'Eksekusi Berhasil!', text: res.message });
          document.getElementById('form-transisi-akademik').reset();
          
          updateStats();
        } catch (err) {
          Swal.fire('Gagal', err.message, 'error');
        } finally {
          btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-power-off me-2"></i>EKSEKUSI TRANSISI';
        }
      }
    });
  });
}

function togglePeringatanTransisi(val) {
  const btn = document.getElementById('btn-eksekusi-transisi');
  
  if (val === 'TAHUN_AJARAN') {
    btn.classList.replace('btn-primary', 'btn-danger');
  } else {
    btn.classList.replace('btn-danger', 'btn-primary');
  }
}

/* Fungsi Bantuan untuk Generate Kop Surat Resmi */
function generateKopSuratHTML(idSekolah) {
  let html = '<div class="kop-surat">';
  html += '<img class="kop-logo" src="' + idSekolah.logo_kiri + '">';
  html += '<div class="kop-teks">';
  html += '<h3>PEMERINTAH PROVINSI KALIMANTAN SELATAN</h3>';
  html += '<h4>DINAS PENDIDIKAN DAN KEBUDAYAAN</h4>';
  html += '<h2>' + idSekolah.nama_sekolah + '</h2>';
  html += '<p>' + idSekolah.alamat_sekolah + '</p>';
  html += '<p>Laman ' + idSekolah.website + ' ; Pos-el ' + idSekolah.email + '</p>';
  html += '</div>';
  html += '<img class="kop-logo" src="' + idSekolah.logo_kanan + '">';
  html += '</div>';
  return html;
}
