from setuptools import setup

setup(
    name="ase_navigation",
    version="1.0.0",
    packages=["ase_navigation"],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/ase_navigation"]),
        ("share/ase_navigation", ["package.xml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    entry_points={"console_scripts": ["navigation_node = ase_navigation.navigation_node:main"]},
)
